import { Command, OptionValues } from "commander";
import { newApi } from "../api";
import {
  getCallerSeedFromEnvOrPrompt,
  initKeyringPair,
} from "../utils/account";
import { parseCTCString, toCTCString } from "../utils/balance";
import { signSendAndWatch, TxStatus } from "../utils/tx";

export function makeFaucetCommand() {
  const cmd = new Command("faucet");
  cmd.description("Mint CTC to your account");
  cmd.option("-a, --amount [amount]", "Amount to send");
  cmd.action(faucetAction);
  return cmd;
}

async function faucetAction(options: OptionValues) {
  const { api } = await newApi(options.url);

  // Check options
  checkAmount(options);

  const amount = parseCTCString(options.amount);

  // Build account
  const callerSeed = await getCallerSeedFromEnvOrPrompt();
  const caller = initKeyringPair(callerSeed);

  const tx = api.tx.creditcoin.faucet(amount);

  const result = await signSendAndWatch(tx, caller, api);

  console.log(result.info);

  if (result.status === TxStatus.ok) {
    console.log(
      `Successfully minted ${toCTCString(amount)} to ${caller.address}`
    );
  } else {
    console.log("Failed to mint CTC");
  }
  process.exit(0);
}

function checkAmount(options: OptionValues) {
  if (!options.amount) {
    console.log("Must specify amount to send");
    process.exit(1);
  }
}
