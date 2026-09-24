#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    Env, String,
};

struct Setup<'a> {
    dao: HelPhoneDaoClient<'a>,
    admin: Address,
    gov: token::Client<'a>,
    reserve: token::Client<'a>,
}

fn setup(env: &Env) -> Setup<'_> {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let gov = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let reserve = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let id = env.register(HelPhoneDao, (admin.clone(), gov.clone()));
    Setup {
        dao: HelPhoneDaoClient::new(env, &id),
        admin,
        gov: token::Client::new(env, &gov),
        reserve: token::Client::new(env, &reserve),
    }
}

fn mint(env: &Env, token: &token::Client, to: &Address, amount: i128) {
    StellarAssetClient::new(env, &token.address).mint(to, &amount);
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

/// Voter holding the whole voting supply, so any For vote passes quorum.
fn voter(env: &Env, t: &Setup) -> Address {
    let v = Address::generate(env);
    mint(env, &t.gov, &v, 1_000);
    t.dao.set_voting_supply(&t.admin, &1_000);
    v
}

fn pass_timelock(env: &Env) {
    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + VOTING_PERIOD_SECS + EXECUTION_DELAY_SECS + 1);
}

#[test]
fn constructor_sets_admin_and_token() {
    let env = Env::default();
    let t = setup(&env);
    assert_eq!(t.dao.get_admin(), Some(t.admin.clone()));
    assert_eq!(t.dao.get_governance_token(), Some(t.gov.address.clone()));
    assert_eq!(t.dao.get_proposal_count(), 0);
}

#[test]
fn governance_params_are_correct() {
    let env = Env::default();
    let t = setup(&env);
    let (voting_period, execution_delay, quorum, pass_threshold) = t.dao.get_governance_params();

    assert_eq!(voting_period, 3 * 24 * 60 * 60); // 3 days
    assert_eq!(execution_delay, 1 * 24 * 60 * 60); // 1 day
    assert_eq!(quorum, 20); // 20%
    assert_eq!(pass_threshold, 50); // 50%
}

#[test]
fn collects_one_percent_into_reserve() {
    let env = Env::default();
    let t = setup(&env);
    t.dao.configure_sustainability(&t.admin, &t.reserve.address);
    let payer = Address::generate(&env);
    mint(&env, &t.reserve, &payer, 1_000_000);

    assert_eq!(t.dao.collect_sustainability_fee(&payer, &250_000), 2_500);
    assert_eq!(t.dao.collect_sustainability_fee(&payer, &99), 0); // below 1 unit of fee
    assert_eq!(t.reserve.balance(&t.dao.address), 2_500);
    assert_eq!(t.reserve.balance(&payer), 997_500);

    let st = t.dao.get_sustainability_stats();
    assert_eq!(st.fee_bps, 100);
    assert_eq!((st.reserve, st.total_collected, st.total_disbursed), (2_500, 2_500, 0));
    assert_eq!(st.token, Some(t.reserve.address.clone()));
}

#[test]
fn passed_grant_is_disbursed_on_execution() {
    let env = Env::default();
    let t = setup(&env);
    t.dao.configure_sustainability(&t.admin, &t.reserve.address);
    let payer = Address::generate(&env);
    mint(&env, &t.reserve, &payer, 10_000_000);
    t.dao.collect_sustainability_fee(&payer, &10_000_000); // reserve = 100_000

    let v = voter(&env, &t);
    let maintainer = Address::generate(&env);
    let pid = t.dao.propose_maintainer_grant(
        &v,
        &maintainer,
        &s(&env, "npm:@stellar/stellar-sdk"),
        &40_000,
        &s(&env, "Fund stellar-sdk"),
        &s(&env, "Critical dependency with a single maintainer"),
    );
    assert_eq!(t.dao.get_proposal(&pid).unwrap().proposal_type, ProposalType::FundAllocation);

    t.dao.cast_vote(&v, &pid, &VoteDirection::For);
    pass_timelock(&env);
    t.dao.execute_proposal(&pid);

    assert_eq!(t.reserve.balance(&maintainer), 40_000);
    let grant = t.dao.get_maintainer_grant(&pid).unwrap();
    assert_eq!(grant.status, sustainability::GrantStatus::Disbursed);
    assert_eq!(t.dao.get_maintainer_funding(&maintainer), 40_000);

    let st = t.dao.get_sustainability_stats();
    assert_eq!((st.reserve, st.total_disbursed), (60_000, 40_000));
    assert_eq!((st.grants_proposed, st.grants_disbursed, st.maintainers_funded), (1, 1, 1));
    assert_eq!(t.dao.try_disburse_grant(&pid), Err(Ok(DaoError::GrantAlreadyDisbursed)));
}

#[test]
fn underfunded_grant_stays_pending_until_reserve_grows() {
    let env = Env::default();
    let t = setup(&env);
    t.dao.configure_sustainability(&t.admin, &t.reserve.address);
    let payer = Address::generate(&env);
    mint(&env, &t.reserve, &payer, 10_000_000);

    let v = voter(&env, &t);
    let maintainer = Address::generate(&env);
    let pid = t.dao.propose_maintainer_grant(
        &v, &maintainer, &s(&env, "cargo:soroban-sdk"), &5_000, &s(&env, "t"), &s(&env, "d"),
    );
    t.dao.cast_vote(&v, &pid, &VoteDirection::For);
    pass_timelock(&env);
    t.dao.execute_proposal(&pid); // reserve is empty: execution still succeeds

    assert_eq!(t.dao.get_proposal(&pid).unwrap().status, ProposalStatus::Executed);
    assert_eq!(t.dao.get_maintainer_grant(&pid).unwrap().status, sustainability::GrantStatus::Pending);
    assert_eq!(t.dao.try_disburse_grant(&pid), Err(Ok(DaoError::InsufficientReserve)));

    t.dao.collect_sustainability_fee(&payer, &500_000); // reserve = 5_000
    assert_eq!(t.dao.disburse_grant(&pid), 5_000);
    assert_eq!(t.reserve.balance(&maintainer), 5_000);
}

#[test]
fn rejected_grant_cannot_be_disbursed() {
    let env = Env::default();
    let t = setup(&env);
    t.dao.configure_sustainability(&t.admin, &t.reserve.address);
    let v = voter(&env, &t);
    let pid = t.dao.propose_maintainer_grant(
        &v, &Address::generate(&env), &s(&env, "npm:x"), &1, &s(&env, "t"), &s(&env, "d"),
    );
    t.dao.cast_vote(&v, &pid, &VoteDirection::Against);
    pass_timelock(&env);

    assert_eq!(t.dao.try_execute_proposal(&pid), Err(Ok(DaoError::NotPassed)));
    assert_eq!(t.dao.try_disburse_grant(&pid), Err(Ok(DaoError::NotPassed)));
}

#[test]
fn rejects_bad_sustainability_inputs() {
    let env = Env::default();
    let t = setup(&env);
    let payer = Address::generate(&env);
    let who = Address::generate(&env);

    assert_eq!(
        t.dao.try_collect_sustainability_fee(&payer, &1_000),
        Err(Ok(DaoError::SustainabilityNotConfigured))
    );
    assert_eq!(
        t.dao.try_propose_maintainer_grant(&who, &who, &s(&env, "p"), &1, &s(&env, "t"), &s(&env, "d")),
        Err(Ok(DaoError::SustainabilityNotConfigured))
    );
    assert_eq!(
        t.dao.try_configure_sustainability(&who, &t.reserve.address),
        Err(Ok(DaoError::NotAdmin))
    );

    t.dao.configure_sustainability(&t.admin, &t.reserve.address);
    assert_eq!(t.dao.try_collect_sustainability_fee(&payer, &0), Err(Ok(DaoError::InvalidAmount)));
    assert_eq!(
        t.dao.try_propose_maintainer_grant(&who, &who, &s(&env, "p"), &0, &s(&env, "t"), &s(&env, "d")),
        Err(Ok(DaoError::InvalidAmount))
    );
    assert_eq!(t.dao.try_disburse_grant(&42), Err(Ok(DaoError::ProposalNotFound)));
}
