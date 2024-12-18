import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import {ZipEntry} from "./types.js";
import { tmpdir } from "node:os";
import path from "node:path";

import {zip, listEntries} from "./index.js";
import { constants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { expect } from "chai";
import { once } from "node:events";

/**
 * Checks a zip file's validity
 */

const external = {
  verify(file :string) :Promise<true>{
    return new Promise((resolve, reject)=>{
      execFile("unzip", ["-t", file], (error, stdout, stderr)=>{
        if(error){
          reject(new Error(`unzip failed with code ${error.code}: ${stderr}`))
        }
        resolve(true);
      });
    })
  },
  async zip(archive: string, ...paths:string[]) :Promise<string>{
    let child = spawn("zip", [
      "-r",
      "--compression-method", "store", 
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
  let dir :string;
  const t1 = new Date('2024-12-18T11:35:32.0Z');
  this.beforeEach(async function(){
    dir = await mkdtemp(path.join(tmpdir(), `abstract-zip-tests-${this.currentTest?.title?.replace(/[^a-zA-Z0-9]/g,"_")}`));
  })
  this.afterEach(async function(){
    await rm(dir, {recursive: true});
  });

  it("creates a valid zip", async function(){
    let entries :ZipEntry[] = [
      {filename: "foo.txt", mtime: t1, stream: [Buffer.from("Hello World\n")]},
      {filename: "nested", mtime: t1, isDirectory: true},
      {filename: "nested/bar.txt", mtime: t1, stream: [Buffer.from("Hello World\n"), Buffer.from("Goodbye World\n")]},
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
    expect(await external.verify(filepath)).to.be.true;
  });

  it("list entries in a zip", async function(){
    let files = [
      dir,
      path.join(dir,"foo.txt"),
      path.join(dir, "nested"),
      path.join(dir, "nested/bar.txt"),
    ]
    await writeFile(files[1], "Hello World\n");
    await mkdir(files[2]);
    await writeFile(files[3], "Hello World\nGoodbye World\n");
    const archive = path.join(dir, "archive.zip");

    let stdout = await external.zip(archive, dir);
    const lines = stdout.split("\n").filter(l=>l);
    expect(lines).to.have.property("length", files.length);

    let entries = await listEntries(archive);
    expect(entries).to.have.property("length", files.length);
  });
})