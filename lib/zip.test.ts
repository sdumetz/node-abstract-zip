import { expect } from "chai";
import {  read_cdh, zip,  } from "./index.js";
import { Readable } from "stream";
import HandleMock from "./__mocks__/handleMock.js";
import { CDHeader } from "./types.js";


function readStream(data=["hello ", "world\n"]){
  return new Readable({
    read(size){
      let b = data.shift();
      if(b) this.push(Buffer.isBuffer(b)?b : Buffer.from(b))
      else this.push(null);
    }
  })
}


describe("read/write zip files", async function(){

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
});
