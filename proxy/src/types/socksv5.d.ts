declare module "socksv5" {
  import { Server as NetServer } from "node:net";

  type SocksRequest = {
    srcAddr: string;
    srcPort: number;
    dstAddr: string;
    dstPort: number;
  };

  type AcceptFn = (grant?: boolean) => NodeJS.ReadWriteStream;
  type RejectFn = () => void;

  export function createServer(
    handler: (info: SocksRequest, accept: AcceptFn, deny: RejectFn) => void,
  ): NetServer & { useAuth: (auth: unknown) => void };

  export const auth: {
    None: () => unknown;
  };
}
