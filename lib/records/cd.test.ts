import { expect } from "chai";
import { flags } from "../constants.js";
import { create_cd_header, parse_cd_header } from "./cd.js";
import { CDHeader } from "../types.js";


let cdHeader :CDHeader = {
  filename: "foo.txt",
  extra: "",
  flags: flags.USE_DATA_DESCRIPTOR | flags.UTF_FILENAME,
  compressedSize: 128,
  size: 128,
  mtime: new Date('2023-03-29T13:02:10.000Z'),
  dosMode: 0x0,
  unixMode: 0o040755,
  crc: 0xaf083b2d,
  offset: 0
};

describe("create_cd_header() / parse_cd_header()", function(){
  it("basic create and parse", function(){

    let buf = create_cd_header(cdHeader);
    let {length,...parsed} = parse_cd_header(buf, 0);
    expect(parsed).to.deep.equal(cdHeader);
    expect(length, "there should be no unused bytes").to.equal(buf.length);
  });
  it("with extra", function(){
    let h ={...cdHeader, extra: "hello world"};
    let buf = create_cd_header(h);
    let {length,...parsed} = parse_cd_header(buf, 0);
    expect(parsed).to.deep.equal(h);
    expect(length, "there should be no unused bytes").to.equal(buf.length);
  });
  it("with a folder", function(){
    let h ={...cdHeader, filename: "/foo/", dosMode: 0x10, unixMode: 0o040755 };
    let buf = create_cd_header(h);
    let {length,...parsed} = parse_cd_header(buf, 0);
    expect(parsed).to.deep.equal(h);
    expect(length, "there should be no unused bytes").to.equal(buf.length);
  });
});
