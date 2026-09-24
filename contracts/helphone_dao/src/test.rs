#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{contract, contractimpl, contracttype, token::StellarAssetClient, token::TokenClient, Bytes, Env, String};

const T0: u64 = 1_000_000;

// ── Mocks ──────────────────────────────────────────────────────────

/// SEP-40 style oracle whose prices are set directly by the tests.
#[contract]
struct MockOracle;

#[contracttype]
enum OracleKey {
    Price(OracleAsset),
}

#[contractimpl]
impl MockOracle {
    pub fn decimals(_env: Env) -> u32 {
        14
    }
    pub fn set_price(env: Env, asset: OracleAsset, price: i128, timestamp: u64) {
        env.storage()
            .instance()
            .set(&OracleKey::Price(asset), &PriceData { price, timestamp });
    }
    pub fn lastprice(env: Env, asset: OracleAsset) -> Option<PriceData> {
        env.storage().instance().get(&OracleKey::Price(asset))
    }
}

/// Governance token exposing the two calls the DAO makes.
#[contract]
struct MockGovToken;

#[contractimpl]
impl MockGovToken {
    pub fn set_balance(env: Env, who: Address, amount: i128) {
        env.storage().instance().set(&who, &amount);
    }
    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage().instance().get(&id).unwrap_or(0)
    }
    pub fn total_supply(_env: Env) -> i128 {
        1_000
    }
}

struct Ctx<'a> {
    env: Env,
    dao: HelPhoneDaoClient<'a>,
    admin: Address,
    gov: Address,
}

fn ctx<'a>() -> Ctx<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(T0);
    let admin = Address::generate(&env);
    let gov = env.register(MockGovToken, ());
    let id = env.register(HelPhoneDao, (admin.clone(), gov.clone()));
    let dao = HelPhoneDaoClient::new(&env, &id);
    Ctx { env, dao, admin, gov }
}

fn sac(env: &Env) -> Address {
    env.register_stellar_asset_contract_v2(Address::generate(env)).address()
}

// ── Governance (constructor + proposal lifecycle) ──────────────────

#[test]
fn constructor_sets_admin_and_token() {
    let c = ctx();
    assert_eq!(c.dao.get_admin(), Some(c.admin.clone()));
    assert_eq!(c.dao.get_governance_token(), Some(c.gov.clone()));
    assert_eq!(c.dao.get_proposal_count(), 0);
    assert_eq!(c.dao.get_governance_params(), (3 * 86_400, 86_400, 20, 50));
    assert_eq!(c.dao.get_oracle(), None);
}

fn propose(c: &Ctx, proposer: &Address) -> u64 {
    c.dao.create_proposal(
        proposer,
        &String::from_str(&c.env, "Fund zone"),
        &String::from_str(&c.env, "desc"),
        &ProposalType::FundAllocation,
        &Bytes::new(&c.env),
    )
}

fn holder(c: &Ctx, weight: i128) -> Address {
    let a = Address::generate(&c.env);
    MockGovTokenClient::new(&c.env, &c.gov).set_balance(&a, &weight);
    a
}

#[test]
fn proposal_passes_and_executes_after_timelock() {
    let c = ctx();
    let voter = holder(&c, 300);
    let id = propose(&c, &voter);
    assert_eq!(id, 1);
    assert_eq!(c.dao.get_total_supply_at(&id), 1_000);

    c.dao.cast_vote(&voter, &id, &VoteDirection::For);
    assert_eq!(c.dao.get_vote(&id, &voter).unwrap().weight, 300);
    assert_eq!(c.dao.get_proposal(&id).unwrap().for_votes, 300);

    // Voting still open, so finalization is refused.
    assert_eq!(c.dao.try_finalize_proposal(&id), Err(Ok(DaoError::VotingClosed)));

    let ends = c.dao.get_proposal(&id).unwrap().voting_ends;
    c.env.ledger().set_timestamp(ends + 1);
    assert_eq!(c.dao.finalize_proposal(&id), ProposalStatus::Passed);
    // Finalizing again is a no-op that reports the settled status.
    assert_eq!(c.dao.finalize_proposal(&id), ProposalStatus::Passed);

    assert_eq!(c.dao.try_execute_proposal(&id), Err(Ok(DaoError::TimelockNotExpired)));
    c.env.ledger().set_timestamp(ends + 86_400);
    c.dao.execute_proposal(&id);
    assert_eq!(c.dao.get_proposal(&id).unwrap().status, ProposalStatus::Executed);
    assert_eq!(c.dao.get_executed_proposals().len(), 1);
    assert_eq!(c.dao.try_execute_proposal(&id), Err(Ok(DaoError::AlreadyExecuted)));
}

#[test]
fn execute_finalizes_an_unsettled_passed_proposal() {
    let c = ctx();
    let voter = holder(&c, 300);
    let id = propose(&c, &voter);
    c.dao.cast_vote(&voter, &id, &VoteDirection::For);
    assert_eq!(c.dao.try_execute_proposal(&id), Err(Ok(DaoError::VotingClosed)));
    let ends = c.dao.get_proposal(&id).unwrap().voting_ends;
    c.env.ledger().set_timestamp(ends + 86_400 + 1);
    c.dao.execute_proposal(&id);
    assert_eq!(c.dao.get_proposal(&id).unwrap().status, ProposalStatus::Executed);
}

#[test]
fn proposal_without_quorum_or_majority_fails() {
    let c = ctx();
    let small = holder(&c, 100); // 10% < 20% quorum
    let id = propose(&c, &small);
    c.dao.cast_vote(&small, &id, &VoteDirection::For);
    let ends = c.dao.get_proposal(&id).unwrap().voting_ends;
    c.env.ledger().set_timestamp(ends + 1);
    assert_eq!(c.dao.finalize_proposal(&id), ProposalStatus::Failed);
    assert_eq!(c.dao.try_execute_proposal(&id), Err(Ok(DaoError::NotPassed)));

    c.env.ledger().set_timestamp(T0);
    let big = holder(&c, 400);
    let id2 = propose(&c, &big);
    c.dao.cast_vote(&big, &id2, &VoteDirection::Against);
    c.env.ledger().set_timestamp(ends + 1);
    assert_eq!(c.dao.finalize_proposal(&id2), ProposalStatus::Failed);
}

#[test]
fn voting_rules_are_enforced() {
    let c = ctx();
    let voter = holder(&c, 300);
    let nobody = Address::generate(&c.env);
    let id = propose(&c, &voter);

    assert_eq!(c.dao.try_cast_vote(&voter, &99, &VoteDirection::For), Err(Ok(DaoError::ProposalNotFound)));
    assert_eq!(c.dao.try_cast_vote(&nobody, &id, &VoteDirection::For), Err(Ok(DaoError::NotTokenHolder)));
    c.dao.cast_vote(&voter, &id, &VoteDirection::Abstain);
    assert_eq!(c.dao.get_proposal(&id).unwrap().abstain_votes, 300);
    assert_eq!(c.dao.try_cast_vote(&voter, &id, &VoteDirection::For), Err(Ok(DaoError::AlreadyVoted)));

    let ends = c.dao.get_proposal(&id).unwrap().voting_ends;
    c.env.ledger().set_timestamp(ends + 1);
    let late = holder(&c, 10);
    assert_eq!(c.dao.try_cast_vote(&late, &id, &VoteDirection::For), Err(Ok(DaoError::VotingClosed)));
}

#[test]
fn cancel_is_limited_to_proposer_or_admin() {
    let c = ctx();
    let proposer = holder(&c, 300);
    let id = propose(&c, &proposer);
    let stranger = Address::generate(&c.env);
    assert_eq!(c.dao.try_cancel_proposal(&stranger, &id), Err(Ok(DaoError::NotAdmin)));
    c.dao.cancel_proposal(&c.admin, &id);
    assert_eq!(c.dao.get_proposal(&id).unwrap().status, ProposalStatus::Cancelled);
    assert_eq!(c.dao.try_cancel_proposal(&proposer, &id), Err(Ok(DaoError::VotingClosed)));
    assert_eq!(c.dao.try_cancel_proposal(&proposer, &42), Err(Ok(DaoError::ProposalNotFound)));
}

#[test]
fn admin_controls_are_admin_only() {
    let c = ctx();
    let other = Address::generate(&c.env);
    let new_token = Address::generate(&c.env);

    assert_eq!(c.dao.try_set_governance_token(&other, &new_token), Err(Ok(DaoError::NotAdmin)));
    c.dao.set_governance_token(&c.admin, &new_token);
    assert_eq!(c.dao.get_governance_token(), Some(new_token));

    assert_eq!(c.dao.try_transfer_admin(&other, &other), Err(Ok(DaoError::NotAdmin)));
    c.dao.transfer_admin(&c.admin, &other);
    assert_eq!(c.dao.get_admin(), Some(other));
}

// ── Price oracle adapter (#543) ────────────────────────────────────

struct Oracle<'a> {
    c: Ctx<'a>,
    feed: MockOracleClient<'a>,
    xlm: Address,
    usdc: Address,
}

fn oracle<'a>() -> Oracle<'a> {
    let c = ctx();
    let feed_id = c.env.register(MockOracle, ());
    let feed = MockOracleClient::new(&c.env, &feed_id);
    let xlm = sac(&c.env);
    let usdc = sac(&c.env);
    c.dao.set_oracle(&c.admin, &feed_id);
    // 1 XLM = 0.12 USD, 1 USDC = 1.00 USD (feed decimals cancel out).
    feed.set_price(&OracleAsset::Stellar(xlm.clone()), &12_000_000_000_000, &T0);
    feed.set_price(&OracleAsset::Stellar(usdc.clone()), &100_000_000_000_000, &T0);
    Oracle { c, feed, xlm, usdc }
}

#[test]
fn set_oracle_is_admin_only() {
    let c = ctx();
    let feed = Address::generate(&c.env);
    assert_eq!(c.dao.try_set_oracle(&Address::generate(&c.env), &feed), Err(Ok(DaoError::NotAdmin)));
    c.dao.set_oracle(&c.admin, &feed);
    assert_eq!(c.dao.get_oracle(), Some(feed));
}

#[test]
fn quote_requires_an_oracle() {
    let c = ctx();
    let a = Address::generate(&c.env);
    let b = Address::generate(&c.env);
    assert_eq!(c.dao.try_quote_conversion(&a, &b, &100), Err(Ok(DaoError::OracleNotSet)));
}

#[test]
fn converts_xlm_to_usdc_and_back_at_live_rates() {
    let o = oracle();
    // 1_000 XLM (7dp) → 120 USDC
    assert_eq!(o.c.dao.quote_conversion(&o.xlm, &o.usdc, &10_000_000_000), 1_200_000_000);
    // 120 USDC → 1_000 XLM
    assert_eq!(o.c.dao.quote_conversion(&o.usdc, &o.xlm, &1_200_000_000), 10_000_000_000);
    // Rounds down: 1 stroop of XLM is worth 0.12 stroop of USDC.
    assert_eq!(o.c.dao.quote_conversion(&o.xlm, &o.usdc, &1), 0);
}

#[test]
fn same_asset_needs_no_price_and_bad_amounts_are_rejected() {
    let o = oracle();
    let unpriced = Address::generate(&o.c.env);
    assert_eq!(o.c.dao.quote_conversion(&unpriced, &unpriced, &55), 55);
    assert_eq!(o.c.dao.try_quote_conversion(&o.xlm, &o.usdc, &0), Err(Ok(DaoError::InvalidAmount)));
    assert_eq!(o.c.dao.try_quote_conversion(&o.xlm, &o.usdc, &-1), Err(Ok(DaoError::InvalidAmount)));
}

#[test]
fn tracks_price_updates() {
    let o = oracle();
    o.feed.set_price(&OracleAsset::Stellar(o.xlm.clone()), &24_000_000_000_000, &T0);
    assert_eq!(o.c.dao.quote_conversion(&o.xlm, &o.usdc, &10_000_000_000), 2_400_000_000);
}

#[test]
fn rejects_prices_older_than_one_hour() {
    let o = oracle();
    // Exactly one hour old is still acceptable…
    o.c.env.ledger().set_timestamp(T0 + MAX_PRICE_AGE_SECS);
    assert_eq!(o.c.dao.quote_conversion(&o.xlm, &o.usdc, &10_000_000_000), 1_200_000_000);
    // …one second more is stale.
    o.c.env.ledger().set_timestamp(T0 + MAX_PRICE_AGE_SECS + 1);
    assert_eq!(
        o.c.dao.try_quote_conversion(&o.xlm, &o.usdc, &10_000_000_000),
        Err(Ok(DaoError::StalePrice))
    );
    // A refreshed feed recovers.
    let now = T0 + MAX_PRICE_AGE_SECS + 1;
    o.feed.set_price(&OracleAsset::Stellar(o.xlm.clone()), &12_000_000_000_000, &now);
    o.feed.set_price(&OracleAsset::Stellar(o.usdc.clone()), &100_000_000_000_000, &now);
    assert_eq!(o.c.dao.quote_conversion(&o.xlm, &o.usdc, &10_000_000_000), 1_200_000_000);
}

#[test]
fn a_single_stale_leg_is_enough_to_reject() {
    let o = oracle();
    o.c.env.ledger().set_timestamp(T0 + 2 * 3_600);
    o.feed.set_price(&OracleAsset::Stellar(o.usdc.clone()), &100_000_000_000_000, &(T0 + 2 * 3_600));
    assert_eq!(
        o.c.dao.try_quote_conversion(&o.xlm, &o.usdc, &1_000),
        Err(Ok(DaoError::StalePrice))
    );
}

#[test]
fn rejects_missing_zero_negative_and_future_prices() {
    let o = oracle();
    let unpriced = Address::generate(&o.c.env);
    assert_eq!(o.c.dao.try_quote_conversion(&unpriced, &o.usdc, &10), Err(Ok(DaoError::PriceUnavailable)));

    o.feed.set_price(&OracleAsset::Stellar(o.xlm.clone()), &0, &T0);
    assert_eq!(o.c.dao.try_quote_conversion(&o.xlm, &o.usdc, &10), Err(Ok(DaoError::InvalidPrice)));
    o.feed.set_price(&OracleAsset::Stellar(o.xlm.clone()), &-5, &T0);
    assert_eq!(o.c.dao.try_quote_conversion(&o.xlm, &o.usdc, &10), Err(Ok(DaoError::InvalidPrice)));

    // Small clock skew is tolerated; large future timestamps are not.
    o.feed.set_price(&OracleAsset::Stellar(o.xlm.clone()), &12_000_000_000_000, &(T0 + 60));
    assert_eq!(o.c.dao.quote_conversion(&o.xlm, &o.usdc, &10_000_000_000), 1_200_000_000);
    o.feed.set_price(&OracleAsset::Stellar(o.xlm.clone()), &12_000_000_000_000, &(T0 + 61));
    assert_eq!(o.c.dao.try_quote_conversion(&o.xlm, &o.usdc, &10), Err(Ok(DaoError::InvalidPrice)));
}

#[test]
fn conversion_overflow_is_reported() {
    let o = oracle();
    assert_eq!(o.c.dao.try_quote_conversion(&o.xlm, &o.usdc, &i128::MAX), Err(Ok(DaoError::Overflow)));
}

#[test]
fn supports_non_stellar_oracle_symbols() {
    let o = oracle();
    let btc = OracleAsset::Other(soroban_sdk::Symbol::new(&o.c.env, "BTC"));
    o.feed.set_price(&btc, &6_000_000_000_000_000, &T0);
    // The DAO addresses assets by token contract, but the adapter handles both variants.
    let feed = o.c.dao.get_oracle().unwrap();
    let usdc = OracleAsset::Stellar(o.usdc.clone());
    o.c.env.as_contract(&o.c.dao.address, || {
        assert_eq!(oracle::convert(&o.c.env, &feed, &btc, &usdc, 2), 120);
    });
}

#[test]
fn disburse_aid_pays_the_converted_amount() {
    let o = oracle();
    let recipient = Address::generate(&o.c.env);
    StellarAssetClient::new(&o.c.env, &o.usdc).mint(&o.c.dao.address, &5_000_000_000);

    let paid = o.c.dao.disburse_aid(&o.c.admin, &recipient, &o.xlm, &o.usdc, &10_000_000_000);

    assert_eq!(paid, 1_200_000_000);
    assert_eq!(TokenClient::new(&o.c.env, &o.usdc).balance(&recipient), 1_200_000_000);
    assert_eq!(TokenClient::new(&o.c.env, &o.usdc).balance(&o.c.dao.address), 3_800_000_000);
}

#[test]
fn disburse_aid_guards_admin_staleness_and_dust() {
    let o = oracle();
    let recipient = Address::generate(&o.c.env);
    StellarAssetClient::new(&o.c.env, &o.usdc).mint(&o.c.dao.address, &5_000_000_000);

    assert_eq!(
        o.c.dao.try_disburse_aid(&recipient, &recipient, &o.xlm, &o.usdc, &10),
        Err(Ok(DaoError::NotAdmin))
    );
    // Rounds to zero: refuse rather than emit an empty payout.
    assert_eq!(
        o.c.dao.try_disburse_aid(&o.c.admin, &recipient, &o.xlm, &o.usdc, &1),
        Err(Ok(DaoError::InvalidAmount))
    );
    o.c.env.ledger().set_timestamp(T0 + MAX_PRICE_AGE_SECS + 1);
    assert_eq!(
        o.c.dao.try_disburse_aid(&o.c.admin, &recipient, &o.xlm, &o.usdc, &10_000_000_000),
        Err(Ok(DaoError::StalePrice))
    );
    assert_eq!(TokenClient::new(&o.c.env, &o.usdc).balance(&recipient), 0);
}
