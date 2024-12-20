import { expect } from "chai";
import { create_eocd_record, find_eocd_index, parse_eocd_record } from "./eocd.js";



describe("find_eocd_index()", function(){
  it("returns -1 if not found", function(){
    expect(find_eocd_index(Buffer.alloc(10))).to.equal(-1);
  });
  it("returns record start index", function(){
    const b = create_eocd_record({files_count: 0, cd_length:0, data_length:0});
    expect(find_eocd_index(b)).to.equal(0);
    expect(find_eocd_index(Buffer.concat([Buffer.alloc(10), b]))).to.equal(10);

  })
  it("checks for a possible false positive within comments", function(){
    let comments = Buffer.alloc(100);
    //Comments contains the "magic byte";
    comments.writeUInt32LE(0x06054b50, 50);
    const b = create_eocd_record({files_count: 0, cd_length:0, data_length:0, comments});
    expect(find_eocd_index(b)).to.equal(0);
  });
})

describe("create_eocd_record() / parse_eocd_record()", function(){

  it("writes comments", function(){
    let b = create_eocd_record({files_count: 0, cd_length: 0, data_length: 0, comments: "Hello World"});

    let record = parse_eocd_record(b);
    expect(record).to.have.property("comments", "Hello World");
  })
})