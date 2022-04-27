// Copyright 2022 Gluwa, Inc. & contributors
// SPDX-License-Identifier: The Unlicense

import { Wallet } from 'ethers';

import { ApiPromise, SubmittableResult } from '@polkadot/api';
import { PalletCreditcoinBlockchain } from '@polkadot/types/lookup';
import { u8aConcat } from '@polkadot/util';
import { blake2AsHex, sha256AsU8a, blake2AsU8a } from '@polkadot/util-crypto';
import { KeyringPair } from '@polkadot/keyring/types';
import { joinSignature } from '@ethersproject/bytes';

export type TxOnSuccess = (result: SubmittableResult) => void;
export type TxOnFail = (result: SubmittableResult | Error | undefined) => void;

export const handleTransaction = (
    api: ApiPromise,
    unsubscribe: () => void,
    result: SubmittableResult,
    onSuccess: (result: SubmittableResult) => void,
    onFail: (result: SubmittableResult | Error | undefined) => void,
) => {
    const { dispatchError, events, status } = result;

    console.log(`current status is ${status.toString()}`);

    if (dispatchError) {
        if (dispatchError.isModule) {
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            const { docs, name, section } = decoded;

            console.log(`${section}.${name}: ${docs.join(' ')}`);
        } else {
            console.log(dispatchError.toString());
        }

        onFail(result);
        unsubscribe();
    }

    if (status.isInBlock) {
        events.forEach(({ event }) => {
            const types = event.typeDef;

            event.data.forEach((data, index) => {
                console.log(`pallet: ${event.section} event name: ${event.method}`);
                console.log(`event types ${types[index].type} event data: ${data.toString()}`);
            });
        });

        onSuccess(result);
        unsubscribe();
    }
};

export const getAddressId = (blockchain: PalletCreditcoinBlockchain | string, externalAddress: string) => {
    const addressId = u8aConcat(Buffer.from(blockchain.toString().toLowerCase()), Buffer.from(externalAddress));

    return blake2AsHex(addressId);
};

export const randomEthWallet = (): Wallet => {
    return Wallet.createRandom();
};

export const ethOwnershipProof = (api: ApiPromise, signer: Wallet, account: string) => {
    return joinSignature(signer._signingKey().signDigest(ownershipProofDigest(api, account)));
};

export const ownershipProof = (api: ApiPromise, signer: KeyringPair, account: string) => {
    return signer.sign(ownershipProofDigest(api, account));
};

const ownershipProofDigest = (api: ApiPromise, account: string) => {
    const bytesParams = api.createType('AccountId32', account).toU8a();
    return blake2AsU8a(sha256AsU8a(bytesParams));
};
