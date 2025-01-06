import { extra_header_length } from "../constants.js";
import { ExtraData } from "../types.js";



export function create_extra_header(extra :ExtraData){

  let length = 0;
  for(let data of extra.values()){
    length += extra_header_length + data.length;
  }
  let b= Buffer.allocUnsafe(length);
  let offset = 0;
  for(let [id, data] of extra.entries()){
    if(typeof id !== "number") throw new Error("Extra data ID must be a number, received "+ typeof id);
    offset = b.writeUInt16LE(id, offset);
    offset = b.writeUInt16LE(data.length, offset);
    offset += data.copy(b, offset);
  }
  return b;
}


export function parse_extra_header(b :Buffer):ExtraData{
  let extra :ExtraData = new Map();
  let offset = 0;
  
  while(offset <= b.length - extra_header_length){
    let id = b.readUInt16LE(offset);
    let size = b.readUInt16LE(offset + 2);
    let data = Buffer.allocUnsafe(size);
    b.copy(data, 0, offset + extra_header_length, offset + extra_header_length + size );
    extra.set(id, data);
    offset += extra_header_length + size;
  }

  return extra;
}