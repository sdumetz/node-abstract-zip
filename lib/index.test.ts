import { copyFile, mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import {ZipEntry} from "./types.js";
import { tmpdir } from "node:os";
import path from "node:path";
import timers from "node:timers/promises";

import {zip, listEntries, openEntry} from "./index.js";
import { constants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { expect } from "chai";
import { once } from "node:events";
import { ECompression } from "./constants.js";

import loremIpsum from "./__mocks__/lorem.js";
import { Readable } from "node:stream";
import { find_eocd_index, parse_eocd_record } from "./records/eocd.js";
import { parse_cd } from "./records/cd.js";
import { randomBytes } from "node:crypto";

/**
 * Checks a zip file's validity
 */
class External{
  compressionMethod = "store";
  verify(file :string) :Promise<string>{
    return new Promise((resolve, reject)=>{
      execFile("unzip", ["-t", file], (error, stdout, stderr)=>{
        stdout = stdout.replace(/^Archive:\s*.*\n/m, "").replace(/At least one error was detected.*\n/m, "");
        if(error){
          reject(new Error(`unzip failed with code ${error.code}:\n${stdout}`))
        }
        resolve(stdout);
      });
    })
  }

  async zip(archive: string, ...paths:string[]) :Promise<string>{
    let child = spawn("zip", [
      "-r",
      "--compression-method", this.compressionMethod, 
      archive,
      ...paths
    ]);
    let b = "";
    child.stdout.setEncoding("utf-8")
    child.stdout.on("data", (chunk)=>{
      b += chunk;
    });
    child.stderr.setEncoding("utf-8")
    child.stderr.on("data", (chunk)=>{
      b += chunk;
    });

    await once(child, "close");
    return b;
  }
}



describe("Integration tests", function(){
  let dir :string, external :External;
  const t1 = new Date('2024-12-18T11:35:32.0Z');
  this.beforeEach(async function(){
    dir = await mkdtemp(path.join(tmpdir(), `abstract-zip-tests-${this.currentTest?.title?.replace(/[^a-zA-Z0-9]/g,"_")}`));
    external = new External();
  })
  this.afterEach(async function(){
    await rm(dir, {recursive: true});
  });

  describe("zip()", function(){
    it("creates a valid zip", async function(){
      let entries :ZipEntry[] = [
        {filename: "foo.txt", mtime: t1, stream: Readable.from([Buffer.from("Hello World\n")])},
        {filename: "nested", mtime: t1, isDirectory: true},
        {filename: "nested/bar.txt", mtime: t1, stream: Readable.from([Buffer.from("Hello World\n"), Buffer.from("Goodbye World\n")])},
      ];
      let filepath = path.join(dir, "archive.zip");
      let handle = await open(filepath, constants.O_WRONLY|constants.O_CREAT);
      try{
        for await (let chunk of zip(entries)){
          await handle.write(chunk);
        }
      }finally{
        await handle.close();
      }
      //Can open it internally
      let entriesResult = await listEntries(filepath);
      expect(entriesResult).to.have.length(3);
      await external.verify(filepath);
    });
  
    it("creates a deflated zip", async function(){
      let filepath = path.join(dir, "archive.zip");
      let handle = await open(filepath, constants.O_WRONLY|constants.O_CREAT);
      try{
        for await (let chunk of zip([{
          filename: "foo.txt",
          mtime: t1,
          compression: ECompression.DEFLATE,
          stream: Readable.from(Buffer.from(loremIpsum)),
        }])){
          await handle.write(chunk);
        }
      }finally{
        await handle.close();
      }
      let entriesResult = await listEntries(filepath);
      expect(entriesResult).to.have.length(1);
      let s = openEntry(filepath, entriesResult[0]);
      let d = "";
      s.on("data", (chunk)=> d+=chunk.toString("utf8"));
      await once(s, "close");
      await external.verify(filepath);
    });

    it("throws if compression method is unsupported", async function(){
      let stream = Readable.from(zip([{
        filename: "foo.txt",
        mtime: t1,
        compression: ECompression.BZIP2,
        stream: Readable.from(Buffer.from("foo\n")),
      }]));
      stream.on("data", ()=>{});
      let [err] = await once(stream, "error");
      expect(err).to.be.instanceof(Error);
      expect(err.message).to.equal("Unsupported compression method : BZIP2");
    })

    it("throws if compression method is unknown", async function(){
      let stream = Readable.from(zip([{
        filename: "foo.txt",
        mtime: t1,
        compression: 253,
        stream: Readable.from(Buffer.from("foo\n")),
      }]));
      stream.on("data", ()=>{});
      let [err] = await once(stream, "error");
      expect(err).to.be.instanceof(Error);
      expect(err.message).to.equal("Unsupported compression method : 253");
    })

    it("throws if a file has not attached stream", async function(){
      let entries :ZipEntry[] = [
        {filename: "foo.txt", mtime: t1},
      ];
      let rs = Readable.from(zip(entries));
      rs.on("data", ()=>{});
      let result = await Promise.race([
        once(rs, "error").then(([e])=>e),
        timers.setTimeout(500, {}, {ref: false}),
      ]);
      expect(result).to.be.instanceof(Error);
    });

  
    it("Force a valid date", async function(){
      let result = Buffer.alloc(0)
      for await (let chunk of zip([{
        filename: "foo.txt",
        mtime: new Date("Invalid Date"),
        stream: Readable.from(Buffer.from("foo\n")),
      }])){
        result = Buffer.concat([result, chunk])
      }
  
      let eocd_index = find_eocd_index(result);
      let eocd = parse_eocd_record(result.subarray(eocd_index));
      let entries = [...parse_cd(result.subarray(eocd.data_length, eocd.data_length + eocd.cd_length))];
      expect(entries).to.have.length(1);
      expect(entries[0]).to.have.property("mtime");
      expect(entries[0].mtime.valueOf()).to.be.within(Date.now()-2000, Date.now());
    });
  
    it("Respects DOS date minimum", async function(){
      let result = Buffer.alloc(0)
      for await (let chunk of zip([{
        filename: "foo.txt",
        mtime: new Date("1970-01-01T00:00:00Z"),
        stream: Readable.from(Buffer.from("foo\n")),
      }])){
        result = Buffer.concat([result, chunk])
      }
  
      let eocd_index = find_eocd_index(result);
      let eocd = parse_eocd_record(result.subarray(eocd_index));
      let entries = [...parse_cd(result.subarray(eocd.data_length, eocd.data_length + eocd.cd_length))];
      expect(entries).to.have.length(1);
      expect(entries[0]).to.have.property("mtime").deep.equal(new Date("1980-01-01T00:00:00Z"))
    });
  });
  

  it("list entries in a zip", async function(){
    let files = [
      dir,
      path.join(dir,"foo.txt"),
      path.join(dir, "nested"),
      path.join(dir, "nested/bar.txt"),
    ]
    await writeFile(files[1], "Hello World");
    await mkdir(files[2]);
    await writeFile(files[3], "Hello World, Goodbye World");
    const archive = path.join(dir, "archive.zip");

    let stdout = await external.zip(archive, dir);
    const lines = stdout.split("\n").filter(l=>l);
    expect(lines).to.have.property("length", files.length);

    let entries = await listEntries(archive);
    expect(entries).to.have.property("length", files.length);expect(entries).to.have.length(4);
    const entry = entries.find(e=>/foo.txt/.test(e.filename));
    expect(entry).to.be.ok;
    let rs = openEntry(archive, entry!);
    let data = Buffer.alloc(0);
    rs.on("data", (chunk)=>{
      data = Buffer.concat([data, chunk]);
    })
    await once(rs, "end");
    expect(data.toString("utf8"), "Output data should match input data").to.equal("Hello World");
  });

  it("opens a deflated zip", async function(){
    const filepath = path.join(dir, "foo.txt");
    const archive = path.join(dir, "archive.zip");
    await writeFile(filepath, loremIpsum);
    external.compressionMethod = "deflate";
    await external.zip(archive, filepath);
    let entries = await listEntries(archive);
    expect(entries).to.have.length(1);
    expect(entries[0]).to.have.property("compression", ECompression.DEFLATE);

    let rs = openEntry(archive, entries[0]);
    let data = Buffer.alloc(0);
    rs.on("data", (chunk)=>{
      data = Buffer.concat([data, chunk]);
    })
    await once(rs, "end");
    expect(data.toString("utf8"), "Output data should match input data").to.equal(loremIpsum);
  });

  it("reuses a file descriptor", async function(){
    const filepath = path.join(dir, "foo.txt");
    const archive = path.join(dir, "archive.zip");
    await writeFile(filepath, loremIpsum);
    external.compressionMethod = "deflate";
    await external.zip(archive, filepath);

    let handle = await open(archive, constants.O_RDONLY);
    try{
      let entries = await listEntries(handle);
      expect(entries).to.have.length(1);
  
      let rs = openEntry(handle.fd, entries[0]);
      let data = Buffer.alloc(0);
      rs.on("data", (chunk)=>{
        data = Buffer.concat([data, chunk]);
      })
      await once(rs, "end");
      expect(data.toString("utf8"), "Output data should match input data").to.equal(loremIpsum);
    }finally{
      await handle.close();
    }

  });

  it("fails to open a bzip2 zip", async function(){
    const filepath = path.join(dir, "foo.txt");
    const archive = path.join(dir, "archive.zip");
    await writeFile(filepath, loremIpsum);
    external.compressionMethod = "bzip2";
    await external.zip(archive, filepath);
    let entries = await listEntries(archive);
    expect(entries).to.have.length(1);
    expect(entries[0]).to.have.property("compression", ECompression.BZIP2);
    expect(()=> openEntry(archive, entries[0])).to.throw("Unsupported compression method : BZIP2");
  });

  it("throws if trying to open a directory", async function(){
    const filepath = path.join(dir, "foo.txt");
    const archive = path.join(dir, "archive.zip");
    await writeFile(filepath, "Hello World\n");
    await external.zip(archive, dir);
    let entries = await listEntries(archive);
    expect(entries).to.have.length(2);
    expect(entries[0]).to.have.property("isDirectory", true);
    
    expect(()=>openEntry(archive, entries[0])).to.throw("Entry is a directory");
  })

  it("throws if file has no Central Directory signature", async function(){
    const archive = path.join(dir, "archive.zip");
    await writeFile(archive, randomBytes(100));
    
    let result = await listEntries(archive).catch(e=>e);
    expect(result).to.be.instanceof(Error);
    expect(result.message).to.equal("Could not find end of central directory record");
  })

})