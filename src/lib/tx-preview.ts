import { LAMPORTS_PER_SOL, SystemProgram, VersionedTransaction } from '@solana/web3.js';

const SYSTEM_PROGRAM_ID = SystemProgram.programId.toBase58();

export interface TxPreview {
  instructionCount: number;
  programIds: string[];
  transfers: Array<{ destination: string; sol: number }>;
  decodeFailed: boolean;
}

export function decodeTxPreview(base64: string): TxPreview {
  const empty: TxPreview = {
    instructionCount: 0,
    programIds: [],
    transfers: [],
    decodeFailed: false,
  };
  try {
    const bytes = Buffer.from(base64, 'base64');
    const tx = VersionedTransaction.deserialize(bytes);
    const keys = tx.message.staticAccountKeys;
    const instructions = tx.message.compiledInstructions;
    const programIdSet = new Set<string>();
    const transfers: Array<{ destination: string; sol: number }> = [];

    for (const ix of instructions) {
      const programKey = keys[ix.programIdIndex];
      if (!programKey) continue;
      const programId = programKey.toBase58();
      programIdSet.add(programId);

      // Decode SystemProgram Transfer: first 4 bytes = instruction index
      // (little-endian u32), Transfer = 2, followed by 8-byte little-endian
      // u64 lamports.
      if (programId === SYSTEM_PROGRAM_ID && ix.data.length >= 12) {
        const data = ix.data;
        const ixType = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
        if (ixType === 2 && ix.accountKeyIndexes.length >= 2) {
          const destIdx = ix.accountKeyIndexes[1];
          const destKey = keys[destIdx];
          if (destKey) {
            const view = new DataView(data.buffer, data.byteOffset + 4, 8);
            const lamports = view.getBigUint64(0, true);
            const sol = Number(lamports) / LAMPORTS_PER_SOL;
            transfers.push({ destination: destKey.toBase58(), sol });
          }
        }
      }
    }

    return {
      instructionCount: instructions.length,
      programIds: Array.from(programIdSet).slice(0, 3),
      transfers,
      decodeFailed: false,
    };
  } catch {
    return { ...empty, decodeFailed: true };
  }
}

export function truncatePubkey(pk: string): string {
  if (pk.length <= 12) return pk;
  return `${pk.slice(0, 4)}${String.fromCharCode(0x2026)}${pk.slice(-4)}`;
}
