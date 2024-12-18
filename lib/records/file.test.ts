import { expect } from "chai"
import { ECompression, flags } from "../constants.js"
import { FileHeader } from "../types.js"
import { create_file_header, parse_file_header } from "./file.js"



describe("create_file_header() / parse_file_header()", function(){
  const entry = {
    filename: "foo.txt",
    mtime: new Date("2024-12-13T11:12:36.000Z"),
    flags: flags.USE_DATA_DESCRIPTOR | flags.UTF_FILENAME,
    compression: ECompression.NO_COMPRESSION,
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
})