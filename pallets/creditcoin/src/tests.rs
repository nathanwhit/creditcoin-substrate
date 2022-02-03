use std::collections::HashMap;

use crate::mock::*;
use bstr::B;
use frame_support::{assert_noop, assert_ok, traits::Get, BoundedVec};
use sp_runtime::offchain::storage::StorageValueRef;

#[extend::ext]
impl<'a, S> &'a [u8]
where
	S: Get<u32>,
{
	fn try_into_bounded(self) -> Result<BoundedVec<u8, S>, ()> {
		core::convert::TryFrom::try_from(self.to_vec())
	}
	fn into_bounded(self) -> BoundedVec<u8, S> {
		core::convert::TryFrom::try_from(self.to_vec()).unwrap()
	}
}

#[test]
fn register_address_basic() {
	ExtBuilder::default().build_and_execute(|| {
		let acct: AccountId = AccountId::new([0; 32]);
		let blockchain = B("testblockchain").into_bounded();
		let value = B("someaddressvalue").into_bounded();
		let network = B("testnetwork").into_bounded();
		assert_ok!(Creditcoin::register_address(
			Origin::signed(acct.clone()),
			blockchain.clone(),
			value.clone(),
			network.clone()
		));
		let address_id = crate::AddressId::new::<Test>(&blockchain, &value, &network);
		let address = crate::Address { blockchain, value, network, sighash: acct };

		assert_eq!(Creditcoin::addresses(address_id), Some(address));
	});
}

#[test]
fn register_address_pre_existing() {
	ExtBuilder::default().build_and_execute(|| {
		let acct: <Test as frame_system::Config>::AccountId = AccountId::new([0; 32]);
		let blockchain = B("testblockchain").into_bounded();
		let address = B("someaddressvalue").into_bounded();
		let network = B("testnetwork").into_bounded();
		assert_ok!(Creditcoin::register_address(
			Origin::signed(acct.clone()),
			blockchain.clone(),
			address.clone(),
			network.clone()
		));

		assert_noop!(
			Creditcoin::register_address(
				Origin::signed(acct.clone()),
				blockchain,
				address,
				network
			),
			crate::Error::<Test>::AddressAlreadyRegistered
		);
	})
}

const ETHLESS_RESPONSES: &[u8] = include_bytes!("tests/ethlessTransfer.json");

#[test]
fn verify_ethless_transfer() {
	let (mut ext, state, _) = ExtBuilder::default().build_offchain();
	let dummy_url = "dummy";
	let tx_hash = "0xcb13b65dd4d9d7f3cb8fcddeb442dfdf767403f8a9e5fe8587859225f8a620e9";
	{
		let mut state = state.write();
		let responses: HashMap<String, serde_json::Value> =
			serde_json::from_slice(ETHLESS_RESPONSES).unwrap();
		let get_transaction = pending_rpc_request(
			"eth_getTransactionByHash",
			vec![tx_hash.into()],
			dummy_url,
			&responses,
		);
		let get_transaction_receipt = pending_rpc_request(
			"eth_getTransactionReceipt",
			vec![tx_hash.into()],
			dummy_url,
			&responses,
		);
		let block_number = pending_rpc_request("eth_blockNumber", None, dummy_url, &responses);

		state.expect_request(get_transaction);
		state.expect_request(get_transaction_receipt);
		state.expect_request(block_number);
	}

	ext.execute_with(|| {
		let rpc_url_storage = StorageValueRef::persistent(B("ethereum-rinkeby-rpc-url"));
		rpc_url_storage.set(&dummy_url);

		let network = B("rinkeby").into_bounded();
		let from = B(
			"0x0ad1439a0e0bfdcd49939f9722866651a4aa9b3c@0xf04349B4A760F5Aed02131e0dAA9bB99a1d1d1e5",
		)
		.into_bounded();
		let to = B(
			"0x0ad1439a0e0bfdcd49939f9722866651a4aa9b3c@0xBBb8bbAF43fE8b9E5572B1860d5c94aC7ed87Bb9",
		)
		.into_bounded();
		let order_id = crate::OrderId::Deal(crate::DealOrderId::dummy());
		let amount = sp_core::U512::from(53688044u64);
		let tx_id = tx_hash.as_bytes().into_bounded();

		assert_ok!(Creditcoin::verify_ethless_transfer(
			&network, &from, &to, &order_id, &amount, &tx_id
		));
	});
}
