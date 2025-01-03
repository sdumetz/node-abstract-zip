import { copyFile, mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import {CDHeader, ZipEntry} from "./types.js";
import { tmpdir } from "node:os";
import path from "node:path";
import timers from "node:timers/promises";

import {zip, listEntries, openEntry, read_cdh} from "./index.js";
import { constants, cpSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { expect } from "chai";
import { once } from "node:events";
import { data_descriptor_length, ECompression, zip64_data_descriptor_length } from "./constants.js";

import loremIpsum from "./__mocks__/lorem.js";
import { Readable, Writable } from "node:stream";
import { find_eocd_index, parse_eocd_record } from "./records/eocd.js";
import { parse_cd } from "./records/cd.js";
import { randomBytes, randomInt } from "node:crypto";
import HandleMock from "./__mocks__/handleMock.js";
import { parse_zip64_data_descriptor, parse_zip64_eocd_record } from "./records/zip64.js";
import { parse_file_header } from "./records/file.js";


const test_zip64 = JSON.parse(process.env["ZIP64_TESTS"] ?? "0");

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

  /**
   * Check if `unzip` is available on this system
   */
  static async available() :Promise<void>{
    return await new Promise((resolve, reject)=>{
      execFile("unzip", ["-v"], (error)=>{
        if(error) reject(error);
        else resolve();
      });
    });
  }
}



describe("Integration tests", function(){

  describe("Mock read/write zip files", async function(){

    function readStream(data=["hello", "world\n"]){
      return new Readable({
        read(size){
          let b = data.shift();
          if(b) this.push(Buffer.isBuffer(b)?b : Buffer.from(b))
          else this.push(null);
        }
      });
    }

    /**
     * yields large chunks of dummy data that always starts with the ascii for "DUMMY"
     * @param size yields `size` bytes of data. Defaults to 2GB
     */
    function *dummyData(size= 1024*1024*1024*2){
      let length = 0;
      const dummyBuffer = Buffer.alloc(64*1024);
      dummyBuffer.write("DUMMY");

      while(length < size - 64*1024){
        length += 64*1024;
        yield dummyBuffer;
      }
      yield dummyBuffer.subarray(0, size - length);
    }

    function createDummyConsummer(){
      let data :{
        data_descriptors: Buffer[],
        file_headers: Buffer[],
        cd?: Buffer,
        eocd?: Buffer,
        zip64eocd?: Buffer,
        data_size: number,
      } = {
        data_descriptors: [],
        file_headers: [],
        data_size: 0,
      };
      return {
        stream: new Writable({
          write(b, encoding, callback){
            if(!Buffer.isBuffer(b)) return callback(new Error(`Expected a buffer, got ${typeof b}`));
            let head = b.subarray(0, 5);
            if(head.toString("utf8") === "DUMMY"){
              data.data_size += b.length;
              return callback();
            }
            let signature = b.readUInt32LE(0);
            switch(signature){
              case 0x08074b50: data.data_descriptors.push(b); break;
              case 0x04034b50: data.file_headers.push(b); break;
              case 0x02014b50: data.cd = b; break;
              case 0x06054b50: data.eocd = b; break;
              case 0x06064b50: data.zip64eocd = b; break;
              default:
                return callback(new Error("Unknown signature "+signature.toString(16)));
            }
            callback();
          },
        }),
        data,
      }
    }
    
    let files = [
      {filename:"articles/", isDirectory: true, mtime: new Date(1673450722892)},
      {filename:"articles/foo.html", mtime: new Date(1673450722892), stream:readStream()},
    ];

    it("read/write files", async function(){
      let handle = new HandleMock();
      for await (let b of zip(files)){
        handle._write(b);
      }
      let count = 0;
      for await (let file of read_cdh(handle as any)){
        expect(file).to.have.property("filename", files[count]["filename"]);
        count++;
      }
      expect(count).to.equal(2);
    });

    it("appends a trailing slash to directory name", async function(){
      //Some softwares (eg. KDE Ark - https://github.com/KDE/ark) use it to detect folders
      let handle = new HandleMock();
      for await (let b of zip([
        {filename:"articles", isDirectory: true, mtime: new Date(1673450722892)}
      ])){
        handle._write(b);
      }
      let headers :CDHeader[] = [];
      for await (let header of read_cdh(handle as any)){
        headers.push(header);
      }
      expect(headers.length).to.equal(1);
      expect(headers[0]).to.have.property("filename", "articles/");
    });

    describe("Zip64", function(){
      this.beforeEach(function(){
        if(!test_zip64) return this.skip();
        this.currentTest?.slow(60000);
        this.currentTest?.timeout(120000);
      });

      it("large archives", async function(){
        let size = Math.floor(0xffffffff/2) +15;
        let {data, stream} = createDummyConsummer();
       
        for await (let b of zip([
          {filename:"foo.txt", isDirectory: false, size, mtime: new Date(1673450722892), stream: Readable.from(dummyData(size))},
          {filename:"bar.txt", isDirectory: false, size, mtime: new Date(1673450722892), stream: Readable.from(dummyData(size))}
        ])){
          stream.write(b); //We don't wait for "drain" because write is actually synchronous here
        }
        
        expect(data.data_size).to.equal(size*2);
        expect(data.file_headers).to.have.length(2);
        expect(data.data_descriptors).to.have.length(2);

        const eocd_expected_offset = [
          ...data.file_headers, 
          ...data.data_descriptors,
        ].reduce(
          (acc, b)=>acc+b.length,
          size*2
        );
        expect(eocd_expected_offset).to.be.above(0xffffffff); //Otherwise we are not testing Zip64

        expect(data.eocd).to.be.ok;
        const eocd_record = parse_eocd_record(data.eocd as Buffer);
        expect(eocd_record).to.have.property("data_length", 0xffffffff);

        expect(data.zip64eocd).to.be.ok;
        const zip64eocd_record = parse_zip64_eocd_record(data.zip64eocd as Buffer, true);
        expect(zip64eocd_record).to.have.property("data_length", eocd_expected_offset);

        expect(data.cd).to.be.ok;
        const cd_header = [...parse_cd(data.cd as Buffer)];
        expect(cd_header).to.have.length(2);
      });
  
      it("large files", async function(){
        let size = 0xffffffff + 15;
        let {stream, data} = createDummyConsummer();
        let rs = Readable.from(zip([
          {filename:"foo.txt", isDirectory: false, size, mtime: new Date(1673450722892), stream: Readable.from(dummyData(size))},
        ]));
        rs.pipe(stream);
        await once(stream, "close");
        expect(data.data_size).to.equal(size);
        const eocd_expected_offset = [
          ...data.file_headers, 
          ...data.data_descriptors,
        ].reduce(
          (acc, b)=>acc+b.length,
          size
        );


        expect(data.file_headers).to.have.length(1);
        let header = parse_file_header(data.file_headers[0]);
        expect(header).to.have.property("size", 0);
        expect(header).to.have.property("compressedSize", 0);
        expect(header).to.have.property("crc", 0);

        expect(data.data_descriptors).to.have.length(1);
        let dd = data.data_descriptors[0];
        expect(dd.length).to.equal(zip64_data_descriptor_length);
        let dd_record = parse_zip64_data_descriptor(dd);
        expect(dd_record).to.have.property("size", size);
        expect(dd_record).to.have.property("compressedSize", size);
        expect(dd_record).to.have.property("crc").not.equal(0); //No reason to expect crc to be bad if it's computed.

        expect(data.cd).to.be.ok;
        const cd_headers = [...parse_cd(data.cd as Buffer)];
        expect(cd_headers).to.have.length(1);
        expect(cd_headers[0]).to.have.property("size", size);
        expect(cd_headers[0]).to.have.property("compressedSize", size);
        expect(cd_headers[0]).to.have.property("crc").equal(dd_record.crc);

        expect(data.eocd).to.be.ok;
        const eocd = parse_eocd_record(data.eocd as Buffer);
        expect(eocd).to.have.property("data_length", 0xffffffff);


        expect(data.zip64eocd).to.be.ok;
        const zip64eocd_record = parse_zip64_eocd_record(data.zip64eocd as Buffer, true);
        expect(zip64eocd_record).to.have.property("data_length", eocd_expected_offset);
      });

      it("large files of unknown length", async function(){
        let size = 0xffffffff + randomInt(0xffff);
        let {stream, data} = createDummyConsummer();
        let rs = Readable.from(zip([
          //Don't provide size to zip()
          {filename:"foo.txt", isDirectory: false, mtime: new Date(1673450722892), stream: Readable.from(dummyData(size))},
        ]));
        rs.pipe(stream);
        await once(stream, "close");
        expect(data.data_size).to.equal(size);

        expect(data.file_headers).to.have.length(1);
        let header = parse_file_header(data.file_headers[0]);
        expect(header).to.have.property("size", 0);
        expect(header).to.have.property("compressedSize", 0);
        expect(header).to.have.property("crc", 0);

        expect(data.data_descriptors).to.have.length(1);
        let dd = data.data_descriptors[0];
        expect(dd.length).to.equal(zip64_data_descriptor_length);
        let dd_record = parse_zip64_data_descriptor(dd);
        expect(dd_record).to.have.property("size", size);
        expect(dd_record).to.have.property("compressedSize", size);
      });

      it("many files", async function(){
        //More than 0xffff file entries
        const files_count = 0x10000
        function *makeEntries(){
          for(let i = 0; i < files_count; i++){
            yield {filename: `dir_${i.toString(16).padStart(5)}`, isDirectory: true, mtime: new Date(1673450722892)}
          }
        }
        console.time("buf");
        let handle = new HandleMock();
        for await (let chunk of zip(makeEntries())){
          handle._write(chunk);
        }
        console.timeEnd("buf");
        let entries = await listEntries(handle as any, true);
        expect(entries).to.have.length(files_count);
      })
    });
  });

  describe("with system unzip", function(){
    let dir :string, external :External;
    const t1 = new Date('2024-12-18T11:35:32.0Z');

    this.beforeAll(async function(){
      try{
        await External.available()
      }catch(e){
        this.skip();
      }
    });

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
        //Can open it externally
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

      const folder = entries.find((e)=>/nested\/$/.test(e.filename));
      expect(folder).to.have.property("isDirectory", true);
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
})

