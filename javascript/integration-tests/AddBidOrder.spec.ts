// Copyright 2022 Gluwa, Inc. & contributors
// SPDX-License-Identifier: The Unlicense

import { Guid } from 'js-guid';

import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { KeyringPair } from '@polkadot/keyring/types';
import { Balance } from '@polkadot/types/interfaces';

import { Blockchain, LoanTerms } from 'credal-js/lib/model';
import { createCreditcoinLoanTerms } from 'credal-js/lib/transforms';
import { AddressRegistered } from 'credal-js/lib/extrinsics/register-address';

import { POINT_01_CTC } from '../src/constants';
import { randomEthAddress } from '../src/utils';
import * as testUtils from './test-utils';

describe('AddBidOrder', (): void => {
    let api: ApiPromise;
    let borrower: KeyringPair;
    let borrowerRegAddr: AddressRegistered;
    let bidGuid: Guid;

    const blockchain: Blockchain = 'Ethereum';
    const expirationBlock = 10_000;
    const loanTerms: LoanTerms = {
        amount: BigInt(1_000),
        interestRate: 100,
        maturity: new Date(10),
    };

    beforeEach(async () => {
        process.env.NODE_ENV = 'test';

        const provider = new WsProvider('ws://127.0.0.1:9944');
        api = await ApiPromise.create({ provider });
        const keyring = new Keyring({ type: 'sr25519' });

        borrower = keyring.addFromUri('//Bob', { name: 'Bob' });
        borrowerRegAddr = await testUtils.registerAddress(api, randomEthAddress(), blockchain, borrower);
        bidGuid = Guid.newGuid();
    });

    afterEach(async () => {
        await api.disconnect();
    });

    it('fee is min 0.01 CTC', async (): Promise<void> => {
        return new Promise((resolve, reject) => {
            const unsubscribe = api.tx.creditcoin
                .addBidOrder(
                    borrowerRegAddr.addressId,
                    createCreditcoinLoanTerms(api, loanTerms),
                    expirationBlock,
                    bidGuid.toString(),
                )
                .signAndSend(borrower, { nonce: -1 }, async ({ dispatchError, events, status }) => {
                    testUtils.expectNoDispatchError(api, dispatchError);

                    if (status.isInBlock) {
                        const balancesWithdraw = events.find(({ event: { method, section } }) => {
                            return section === 'balances' && method === 'Withdraw';
                        });

                        expect(balancesWithdraw).toBeTruthy();

                        // const accountId = balancesWithdraw.event.data[0].toString();
                        if (balancesWithdraw) {
                            const fee = (balancesWithdraw.event.data[1] as Balance).toBigInt();

                            const unsub = await unsubscribe;

                            if (typeof unsub === 'function') {
                                unsub();
                                resolve(fee);
                            } else {
                                reject(new Error('Subscription failed'));
                            }
                        } else {
                            reject(new Error("Fee wasn't found"));
                        }
                    }
                })
                .catch((error) => reject(error));
        }).then((fee) => {
            expect(fee).toBeGreaterThanOrEqual(POINT_01_CTC);
        });
    });
});
