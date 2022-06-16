pub mod errors;
pub mod rpc;
pub mod tasks;

use crate::{Blockchain, Call, TransferKind};
pub use errors::{OffchainError, VerificationFailureCause, VerificationResult};

use self::errors::RpcUrlError;

use super::{
	pallet::{Config, Error, Pallet},
	ExternalAddress,
};
use alloc::string::String;
use frame_system::offchain::{Account, SendSignedTransaction, Signer};
use sp_runtime::offchain::storage::StorageValueRef;
use sp_std::prelude::*;

pub type OffchainResult<T, E = errors::OffchainError> = Result<T, E>;

impl Blockchain {
	pub fn rpc_url(&self) -> OffchainResult<String, errors::RpcUrlError> {
		let chain_prefix = self.as_bytes();
		let mut buf = Vec::from(chain_prefix);
		buf.extend("-rpc-uri".bytes());
		let rpc_url_storage = StorageValueRef::persistent(&buf);
		if let Some(url_bytes) = rpc_url_storage.get::<Vec<u8>>()? {
			Ok(String::from_utf8(url_bytes)?)
		} else {
			Err(RpcUrlError::NoValue)
		}
	}
	pub fn supports(&self, kind: &TransferKind) -> bool {
		match (self, kind) {
			(
				Blockchain::Ethereum | Blockchain::Luniverse | Blockchain::Rinkeby,
				TransferKind::Erc20(_) | TransferKind::Ethless(_) | TransferKind::Native,
			) => true,
			(Blockchain::Bitcoin, TransferKind::Native) => true,
			(_, _) => false, // TODO: refine this later
		}
	}
}

const ETH_CONFIRMATIONS: u64 = 12;

fn parse_eth_address(address: &ExternalAddress) -> OffchainResult<rpc::Address> {
	let address_bytes = <[u8; 20]>::try_from(address.as_slice())
		.map_err(|_| VerificationFailureCause::InvalidAddress)?;
	let address = rpc::Address::from(address_bytes);
	Ok(address)
}

impl<T: Config> Pallet<T> {
	pub(crate) fn ocw_result_handler<O: core::fmt::Debug>(
		verification_result: VerificationResult<O>,
		success_dispatcher: impl Fn(O) -> Result<(), Error<T>>,
		failure_dispatcher: impl Fn(VerificationFailureCause) -> Result<(), Error<T>>,
		task_status: LocalVerificationStatus,
		unverified_task: &impl core::fmt::Debug,
	) {
		log::debug!("Task Verification result: {:?}", verification_result);
		match verification_result {
			Ok(output) => {
				if let Err(e) = success_dispatcher(output) {
					log::error!("Failed to send success dispatchable transaction: {:?}", e);
				} else {
					task_status.mark_complete();
				}
			},
			Err(OffchainError::InvalidTask(cause)) => {
				log::warn!("Failed to verify pending task {:?} : {:?}", unverified_task, cause);
				if cause.is_fatal() {
					if let Err(e) = failure_dispatcher(cause) {
						log::error!("Failed to send fail dispatchable transaction: {:?}", e);
					} else {
						task_status.mark_complete();
					}
				}
			},
			Err(error) => {
				log::error!("Task verification encountered an error {:?}", error);
			},
		}
	}

	pub fn offchain_signed_tx(
		auth_id: T::FromAccountId,
		call: impl Fn(&Account<T>) -> Call<T>,
	) -> Result<(), Error<T>> {
		use sp_core::crypto::UncheckedFrom;
		let auth_bytes: &[u8; 32] = auth_id.as_ref();
		let public: T::PublicSigning = T::InternalPublic::unchecked_from(*auth_bytes).into();
		let signer =
			Signer::<T, T::AuthorityId>::any_account().with_filter(sp_std::vec![public.into()]);
		let result = signer.send_signed_transaction(call);

		if let Some((acc, res)) = result {
			if res.is_err() {
				log::error!("failure: offchain_signed_tx: tx sent: {:?}", acc.id);
				return Err(Error::OffchainSignedTxFailed);
			} else {
				return Ok(());
			}
		}

		log::error!("No local account available");
		Err(Error::NoLocalAcctForSignedTx)
	}
}

pub(crate) struct LocalVerificationStatus<'a> {
	storage_ref: StorageValueRef<'a>,
	key: &'a [u8],
}

impl<'a> LocalVerificationStatus<'a> {
	pub(crate) fn new(storage_key: &'a [u8]) -> Self {
		Self { storage_ref: StorageValueRef::persistent(storage_key), key: storage_key }
	}

	pub(crate) fn is_complete(&self) -> bool {
		match self.storage_ref.get::<()>() {
			Ok(Some(())) => true,
			Ok(None) => false,
			Err(e) => {
				log::warn!(
					"Failed to decode offchain storage for {}: {:?}",
					hex::encode(self.key),
					e
				);
				true
			},
		}
	}

	pub(crate) fn mark_complete(&self) {
		self.storage_ref.set(&());
	}
}

#[cfg(test)]
mod tests;
