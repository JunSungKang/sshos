import { posix } from "node:path";
import type { Stats } from "ssh2";
import { remotePathSchema } from "../../shared/files";
import type { TransferStat } from "../../shared/transfers";
import {
  controlCall,
  verifyDirectory,
  type ControlAccess,
} from "../remote-files/sftp-control";
import { remoteCapacity } from "./remote-capacity";
import { remoteTransferStat } from "./ports";
export class TransferInspector {
  constructor(
    private readonly control: (
      serverId: string,
      generation: number,
    ) => ControlAccess,
  ) {}
  async destination(
    serverId: string,
    generation: number,
    path: string,
    parent: string,
    size: number,
  ) {
    await this.inspect(serverId, generation, "upload", path, parent);
    const control = this.control(serverId, generation);
    return remoteCapacity(control.sftp, parent, size, (start) =>
      controlCall(control, start),
    );
  }
  async inspect(
    serverId: string,
    generation: number,
    direction: "upload" | "download" | "observe",
    path: string,
    parent: string,
  ): Promise<TransferStat | null> {
    remotePathSchema.parse(path);
    if (path === "/" || posix.dirname(path) !== parent)
      throw new Error("PATH_UNSUPPORTED");
    const control = this.control(serverId, generation);
    await verifyDirectory(control, parent);
    let stat: Stats;
    try {
      stat = await controlCall<Stats>(control, (done) =>
        control.sftp.lstat(path, done),
      );
    } catch (error) {
      if ((error as { code?: number }).code === 2) {
        if (direction !== "download") return null;
        throw new Error("PATH_UNSUPPORTED");
      }
      throw error;
    }
    if (direction === "upload") throw new Error("NAME_CONFLICT");
    return remoteTransferStat(stat);
  }
}
