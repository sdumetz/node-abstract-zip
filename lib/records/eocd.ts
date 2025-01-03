import assert from "node:assert";
import { eocd_length } from "../constants.js";


export interface EOCDRecordParams{
  /**Total number of files in this archive */
  files_count:number;
  /**Byte length of the central directory headers */
  cd_length: number;
  /**Byte length of the archive's data */
  data_length: number;
  comments?:string|Buffer;
}

export interface EOCDRecord extends EOCDRecordParams{
  comments :string;
}

export function create_eocd_record({files_count, cd_length, data_length, comments = Buffer.allocUnsafe(0)}:EOCDRecordParams) :Buffer{
  if(typeof comments === "string"){
    comments = Buffer.from(comments, "utf8");
  }
  const eocdr = Buffer.allocUnsafe(eocd_length + comments.length);
  eocdr.writeUInt32LE(0x06054b50, 0);
  eocdr.writeUInt16LE(0, 4); //Disk number
  eocdr.writeUInt16LE(0, 6); //start disk of CD
  eocdr.writeUInt16LE(files_count, 8); //records on this disk
  eocdr.writeUInt16LE(files_count, 10) //total records
  eocdr.writeUInt32LE(cd_length, 12); //Size of central directory
  eocdr.writeUInt32LE(data_length, 16); //central directory offset
  eocdr.writeUInt16LE(Buffer.byteLength(comments), 20) //comments length
  comments.copy(eocdr, eocd_length);
  return eocdr;
}

export function parse_eocd_record(eocdr :Buffer) :EOCDRecord{
  let signature = eocdr.readUInt32LE(0);
  assert(signature == 0x06054b50, `Expect end of central directory record to start with 0x06054b50, found 0x${signature.toString(16)}`);
  /**@fixme check if disk number == 0 */
  /**@fixme check if start_disk == 0 */
  /**@fixme check if records_on_disk == total_records */
  const comments_length = eocdr.readUInt16LE(20);
  const cd_length = eocdr.readUInt32LE(12);
  return {
    files_count: eocdr.readUInt16LE(8),
    cd_length: cd_length,
    data_length: eocdr.readUInt32LE(16),
    comments: eocdr.slice(eocd_length, eocd_length + comments_length).toString("utf8"),
  };
}

/**
 * Find start-index of "End of Central Directory" record within a buffer
 * 
 * That is, something with 0x06054b50. Then check for false positives by verifying if comment length matches.
 * 
 * @param length Total length from start of buffer to end of file, if buffer is a partial view.
 * @return the index or -1 if not found 
 */
export function find_eocd_index(b : Buffer, length :number = b.length) :number{
  for(let offset = Math.min(length, b.length) - eocd_length; 0 <= offset; offset--){
    //Find a eocd signature matching a correct comments length
    if(b.readUInt32LE(offset) == 0x06054b50 && b.readUInt16LE(offset + eocd_length - 2) == (length - offset - eocd_length)){
      return offset;
    }
  }
  return -1;
}
