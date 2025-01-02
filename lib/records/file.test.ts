import { expect } from "chai"
import { ECompression, flags } from "../constants.js"
import { FileHeader } from "../types.js"
import { create_file_header, parse_file_header } from "./file.js"
import { randomInt } from "node:crypto"



describe("create_file_header() / parse_file_header()", function(){
  const entry = {
    filename: "foo.txt",
    mtime: new Date("2024-12-13T11:12:36.000Z"),
    flags: flags.USE_DATA_DESCRIPTOR | flags.UTF_FILENAME,
    compression: ECompression.NO_COMPRESSION,
    crc: 0,
    compressedSize: 0,
    size: 0,
  }
  const header = "UEsDBBQACAgAAJJZjVkAAAAAAAAAAAAAAAAHAAAAZm9vLnR4dA==";
  it("create directory entry", function(){
    let b = create_file_header(entry);
    expect(b.toString("base64")).to.equal(header);
  });
  
  it("parse directory entry", function(){
    let res = parse_file_header(Buffer.from(header, "base64"));
    expect(res).to.deep.include(entry);
    expect(res).to.have.property("compression", ECompression.NO_COMPRESSION);
  });
  
  it("supports DEFLATE compression", function(){
    let b = create_file_header({...entry, compression: ECompression.DEFLATE});
    let output = parse_file_header(b);
    expect(output).to.have.property("compression", ECompression.DEFLATE);
  });

  it("can be supplied with size, compressedSize and crc32", function(){
    let e = {...entry, size: randomInt(0, 0xffffffff), compressedSize: randomInt(0, 0xffffffff), crc: randomInt(0, 0xffffffff)}
    let b = create_file_header(e);
    let result = parse_file_header(b);
    expect(result).to.deep.equal({...e, extra: new Map()});
  });
})