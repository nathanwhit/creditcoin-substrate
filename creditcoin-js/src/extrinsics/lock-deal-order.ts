import { ApiPromise, SubmittableResult } from '@polkadot/api';
import { DealOrderLocked, DealOrderId } from '../model';
import { createDealOrder } from '../transforms';
import { TxCallback, TxFailureCallback } from '../types';
import { handleTransaction, processEvents } from './common';
import { KeyringPair } from '@polkadot/keyring/types';

export const lockDealOrder = async (
    api: ApiPromise,
    dealOrderId: DealOrderId,
    borrower: KeyringPair,
    onSuccess: TxCallback,
    onFail: TxFailureCallback,
) => {
    const ccDealOrderId = api.createType('PalletCreditcoinDealOrderId', dealOrderId);
    const unsubscribe: () => void = await api.tx.creditcoin
        .lockDealOrder(ccDealOrderId)
        .signAndSend(borrower, { nonce: -1 }, (result) =>
            handleTransaction(api, unsubscribe, result, onSuccess, onFail),
        );
};

export const processDealOrderLocked = (api: ApiPromise, result: SubmittableResult): DealOrderLocked => {
    return processEvents(
        api,
        result,
        'DealOrderLocked',
        'PalletCreditcoinDealOrder',
        createDealOrder,
    ) as DealOrderLocked;
};

export const lockDealOrderAsync = (
    api: ApiPromise,
    dealOrderId: DealOrderId,
    borrower: KeyringPair,
): Promise<DealOrderLocked> => {
    return new Promise<DealOrderLocked>((resolve, reject) => {
        const onSuccess = (result: SubmittableResult) => resolve(processDealOrderLocked(api, result));
        lockDealOrder(api, dealOrderId, borrower, onSuccess, reject).catch(reject);
    });
};
