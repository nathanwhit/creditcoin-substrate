import { providers, Wallet } from 'ethers';
import { Guid } from 'js-guid';

import { Keyring } from '@polkadot/api';
import { Option } from '@polkadot/types';
import { BN } from '@polkadot/util';
import { KeyringPair } from '@polkadot/keyring/types';
import { PalletCreditcoinAddress } from '@polkadot/types/lookup';

import { Blockchain, LoanTerms, DealOrderId, Currency } from './model';
import { CreditcoinApi } from './types';
import { createAddress } from './transforms';
import { EthConnection } from './examples/ethereum';
import { AddressRegistered, createAddressId } from './extrinsics/register-address';
import { createCurrencyId, registerCurrencyAsync } from './extrinsics/register-currency';

type CreateWalletFunc = (who: string) => Wallet;

export type TestData = {
    blockchain: Blockchain;
    expirationBlock: number;
    keyring: Keyring;
    createWallet: CreateWalletFunc;
};

export const testData = (ethereumChain: Blockchain, createWalletF: CreateWalletFunc): TestData => {
    return {
        blockchain: ethereumChain,
        expirationBlock: 10_000_000,
        createWallet: createWalletF,
        keyring: new Keyring({ type: 'sr25519' }),
    };
};

const ensureCurrencyRegistered = async (ccApi: CreditcoinApi, currency: Currency, sudoKey?: KeyringPair) => {
    const id = createCurrencyId(ccApi.api, currency);
    const onChainCurrency = await ccApi.api.query.creditcoin.currencies(id);
    if (onChainCurrency.isEmpty) {
        if (sudoKey === undefined) {
            const keyring = new Keyring({ type: 'sr25519' });
            sudoKey = keyring.addFromUri('//Alice');
        }
        const { itemId } = await registerCurrencyAsync(ccApi.api, currency, sudoKey);
        if (itemId !== id) {
            throw new Error(`Unequal: ${itemId} !== ${id}`);
        }
    }
};

export const loanTermsWithCurrency = async (ccApi: CreditcoinApi, currency: Currency): Promise<LoanTerms> => {
    const currencyId = createCurrencyId(ccApi.api, currency);
    await ensureCurrencyRegistered(ccApi, currency);

    return {
        amount: new BN(1_000),
        interestRate: {
            ratePerPeriod: 100,
            decimals: 4,
            period: {
                secs: 60 * 60 * 24,
                nanos: 0,
            },
            interestType: 'Simple',
        },
        termLength: {
            secs: 60 * 60 * 24 * 30,
            nanos: 0,
        },
        currency: currencyId,
    };
};

export const addAskAndBidOrder = async (
    ccApi: CreditcoinApi,
    lender: KeyringPair,
    borrower: KeyringPair,
    loanTerms: LoanTerms,
    testingData: TestData,
) => {
    const {
        extrinsics: { addAskOrder, addBidOrder, registerAddress },
        utils: { signAccountId },
    } = ccApi;

    const { blockchain, expirationBlock } = testingData;
    const lenderWallet = Wallet.createRandom();
    const borrowerWallet = Wallet.createRandom();

    const [lenderRegAddr, borrowerRegAddr] = await Promise.all([
        registerAddress(lenderWallet.address, blockchain, signAccountId(lenderWallet, lender.address), lender),
        registerAddress(borrowerWallet.address, blockchain, signAccountId(borrowerWallet, borrower.address), borrower),
    ]);
    const askGuid = Guid.newGuid();
    const bidGuid = Guid.newGuid();

    const [askOrderAdded, bidOrderAdded] = await Promise.all([
        addAskOrder(lenderRegAddr.itemId, loanTerms, expirationBlock, askGuid, lender),
        addBidOrder(borrowerRegAddr.itemId, loanTerms, expirationBlock, bidGuid, borrower),
    ]);

    return [askOrderAdded.itemId, bidOrderAdded.itemId];
};

export const lendOnEth = async (
    lenderWallet: Wallet,
    borrowerWallet: Wallet,
    dealOrderId: DealOrderId,
    loanTerms: LoanTerms,
    connection: EthConnection,
) => {
    const { lend, waitUntilTip } = connection;

    // Lender lends to borrower on ethereum
    const [, lendTxHash, lendBlockNumber] = await lend(
        lenderWallet,
        borrowerWallet.address,
        dealOrderId[1],
        loanTerms.amount,
    );

    // wait 15 blocks on Ethereum
    await waitUntilTip(lendBlockNumber + 15);

    return lendTxHash;
};

export const tryRegisterAddress = async (
    ccApi: CreditcoinApi,
    externalAddress: string,
    blockchain: Blockchain,
    ownershipProof: string,
    signer: KeyringPair,
    checkForExisting = false,
): Promise<AddressRegistered> => {
    const {
        api,
        extrinsics: { registerAddress },
    } = ccApi;

    if (checkForExisting) {
        const existingAddressId = createAddressId(blockchain, externalAddress);
        const result = await api.query.creditcoin.addresses<Option<PalletCreditcoinAddress>>(existingAddressId);

        if (result.isSome) {
            return {
                itemId: existingAddressId,
                item: createAddress(result.unwrap()),
            } as AddressRegistered;
        }
    }

    return registerAddress(externalAddress, blockchain, ownershipProof, signer);
};

export const registerCtcDeployerAddress = async (
    ccApi: CreditcoinApi,
    privateKey: string,
    ethereumNodeUrl: string,
    reuseExistingAddresses: boolean,
    testingData: TestData,
): Promise<AddressRegistered> => {
    const { keyring, blockchain } = testingData;
    const {
        utils: { signAccountId },
    } = ccApi;

    const deployer = keyring.addFromUri('//Alice');

    const provider = new providers.JsonRpcProvider(ethereumNodeUrl);
    const deployerWallet = new Wallet(privateKey, provider);

    return tryRegisterAddress(
        ccApi,
        deployerWallet.address,
        blockchain,
        signAccountId(deployerWallet, deployer.address),
        deployer,
        reuseExistingAddresses,
    );
};