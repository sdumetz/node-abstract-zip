import { expect } from "chai";
import { create_data_descriptor, parse_data_descriptor } from "./dd.js"



describe("create_data_descriptor() / parse_data_descriptor()", function(){
  it("makes a valid data descriptor", function(){
    let header = {size: 1024, compressedSize:512, crc: 0x12345678};
    let b = create_data_descriptor(header);
    expect(parse_data_descriptor(b)).to.deep.equal(header);
  });

  it("parse a data-descriptor without optional signature");
  let header = {size: 1024, compressedSize:512, crc: 0x12345678};
  let b = create_data_descriptor(header).subarray(4);
  expect(parse_data_descriptor(b)).to.deep.equal(header);
});
