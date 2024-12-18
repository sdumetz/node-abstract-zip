import { data_descriptor_size } from "../constants.js";


export function create_data_descriptor({size, compressedSize=size, crc}: {size:number,compressedSize?:number, crc:number}):Buffer{
  let dd = Buffer.allocUnsafe(data_descriptor_size);
  dd.writeUInt32LE(0x08074b50, 0);
  dd.writeUInt32LE(crc, 4);
  dd.writeUInt32LE(compressedSize, 8) //Compressed size
  dd.writeUInt32LE(size, 12); // Uncompressed size
  return dd;
}