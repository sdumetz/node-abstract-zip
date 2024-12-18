import type { FileHandle } from "node:fs/promises";

/**
 * Dummy mock for `node:fs.FileHandle`
 */
export default class HandleMock{
  data = Buffer.alloc(0);

  static Create(...buffers :Buffer[]){
    return new HandleMock(...buffers) as any as FileHandle;
  }

  constructor(...buffers:Buffer[]){
    for(let b of buffers){
      this._write(b);
    }
  }
  _write(d:Buffer){
    this.data = Buffer.concat([this.data, d]);
  }

  async stat(){
    return Promise.resolve({
      size: this.data.length,
    });
  }
  async read({buffer, position} :{buffer:Buffer, position :number}){
    return Promise.resolve({bytesRead: this.data.copy(buffer, 0, position)});
  }
  /**
   * This is totally fake and unusable but we don't expect to be consuming the read stream for real
   */
  async createReadStream({start, end}:{start:number, end:number}){
    return this.data.slice(start, end);
  }
}
