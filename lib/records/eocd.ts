import assert from "node:assert";
import { eocd_length } from "../constants.js";


export interface EOCDRecordParams{
  files_count:number;
  cd_length: number;
  data_length: number;
  comments?:string;
}

export interface EOCDRecord extends EOCDRecordParams{
  comments :string;
}

export function create_eocd_record({files_count, cd_length, data_length, comments = ""}:EOCDRecordParams) :Buffer{
  const eocdr = Buffer.allocUnsafe(eocd_length + Buffer.byteLength(comments));
  eocdr.writeUInt32LE(0x06054b50, 0);
  eocdr.writeUInt16LE(0, 4); //Disk number
  eocdr.writeUInt16LE(0, 6); //start disk of CD
  eocdr.writeUInt16LE(files_count, 8); //records on this disk
  eocdr.writeUInt16LE(files_count, 10) //total records
  eocdr.writeUInt32LE(cd_length, 12); //Size of central directory
  eocdr.writeUInt32LE(data_length, 16); //central directory offset
  eocdr.writeUInt16LE(Buffer.byteLength(comments), 20) //comments length
  eocdr.write(comments, eocd_length, "utf-8");
  return eocdr;
}

export function parse_eocd_record(eocdr :Buffer) :EOCDRecord{
  let signature = eocdr.readUInt32LE(0);
  assert(signature == 0x06054b50, `Expect end of central directory record to start with 0x06054b50, found 0x${signature.toString(16)}`);
  /**@fixme check if disk number == 0 */
  /**@fixme check if start_disk == 0 */
  /**@fixme check if records_on_disk == total_records */
  const comments_length = eocdr.readUInt16LE(20);
  return {
    files_count: eocdr.readUInt16LE(8),
    cd_length: eocdr.readUInt32LE(12),
    data_length: eocdr.readUInt32LE(16),
    comments: eocdr.slice(eocd_length, eocd_length + comments_length).toString("utf8"),
  };
}