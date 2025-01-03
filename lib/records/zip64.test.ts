import { expect } from "chai";
import { create_zip64_data_descriptor, create_zip64_eocd_record, create_zip64_extra_field, parse_zip64_data_descriptor, parse_zip64_eocd_locator, parse_zip64_eocd_record, parse_zip64_extra_field, Zip64EOCDRecord, Zip64EOCDRecordParams } from "./zip64.js";
import { zip64_eocd_length, zip64_locator_length } from "../constants.js";

import { randomInt } from "node:crypto";


describe("create_zip64_eocd_record() / parse_zip64_eocd_record", function(){
  let header :Zip64EOCDRecord;
  this.beforeEach(function(){
    header = {
      files_count: 0,
      cd_length:0,
      data_length:0,
      made_by: 3, //UNIX
      version: 45,
      version_needed: 45,
      ext: new Map(),
    }
  });

  it("creates a record", function(){
    let b = create_zip64_eocd_record(header);
    expect(parse_zip64_eocd_record(b)).to.deep.equal(header);
  });

  it("adds the locator trailer", function(){
    let b = create_zip64_eocd_record(header);
    expect(b.readUInt32LE(b.length - zip64_locator_length)).to.equal(0x07064b50);
  });

  it("parse the locator trailer", function(){
    header.data_length = 1000; //Arbitrary length, not verified
    header.cd_length = 500;
    let b = create_zip64_eocd_record(header);
    let record_offset = parse_zip64_eocd_locator(b.subarray(zip64_eocd_length));
    expect(record_offset).to.equal(1500);
    //Strict mode
    record_offset = parse_zip64_eocd_locator(b.subarray(zip64_eocd_length), true);
    expect(record_offset).to.equal(1500);
  });

  it("throws on invalid signature", function(){
    let b = Buffer.alloc(zip64_locator_length);
    b.writeUInt32LE(0x07064b50 + 1, 0);
    expect(() => parse_zip64_eocd_locator(b)).to.throw();
  });

  it("includes extra data", function(){
    header.ext.set(0x0005, Buffer.from("Hello World"));
    let b = create_zip64_eocd_record(header);
    let parsed = parse_zip64_eocd_record(b);
    expect(parsed.ext).to.have.property("size", 1);
    expect(parsed).to.deep.equal(header);
  });
});

describe("create_zip64_extra_field() / parse_zip64_extra_field()", function(){
  it("creates a field buffer", function(){
    let header = {
      size: randomInt(0, 2**48 - 1),
      compressedSize : randomInt(0,  2**48 - 1),
      offset: randomInt(0,  2**48 - 1),
    }
    let b = create_zip64_extra_field(header);
    let result = parse_zip64_extra_field(b);
    expect(result).to.deep.equal(header);
  });
});

describe("create_zip64_data_descriptor()", function(){
  it("creates a 64bits data descriptor", function(){
    const header = {size: randomInt(0,  2**48 - 1), compressedSize: randomInt(0,  2**48 - 1), crc: randomInt(0, 0xffffffff)};
    let dd = create_zip64_data_descriptor(header);
    let result = parse_zip64_data_descriptor(dd.subarray(4));
    expect(result).to.deep.equal(header);
    result = parse_zip64_data_descriptor(dd);
    expect(result).to.deep.equal(header);
  });
});