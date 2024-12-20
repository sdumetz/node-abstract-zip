import { expect } from "chai";
import { create_extra_header, parse_extra_header } from "./extra.js"



describe("create_extra_header", function(){
  it('makes an empty buffer', function(){
    let b = create_extra_header(new Map());
    expect(b).to.have.length(0);
  });
  it('makes a valid header', function(){
    let b = create_extra_header(new Map([[0x0001, Buffer.from("0003", "hex")]]));
    // 0x0001 0x0002 0x0003 but the first two are low-endian
    expect(b.toString("hex")).to.equal(`010002000003`);
  });
});

describe("parse_extra_header", function(){
  it("parse empty header", function(){
    let h = parse_extra_header(Buffer.alloc(0));
    expect(h).to.be.instanceof(Map);
    expect(h.size).to.equal(0);
  });
  it("parse extra header", function(){
    // 0x0001 0x0002 0x0003 but the first two are low-endian
    let h = parse_extra_header(Buffer.from(`010002000003`, "hex"));
    expect(h).to.be.instanceof(Map);
    expect(h.size).to.equal(1);
    expect(h.get(0x0001)?.toString("hex")).to.equal("0003");
  });
});
