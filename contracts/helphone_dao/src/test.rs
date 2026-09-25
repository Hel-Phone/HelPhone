#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec as SorobanVec};

fn create_test_env() -> (Env, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    (env, admin, token)
}

#[test]
fn constructor_sets_admin_and_token() {
    let (env, admin, token) = create_test_env();
    env.mock_all_auths();

    let contract = HelPhoneDao;
    env.register_contract(&Address::generate(&env), contract);

    let contract_addr = Address::generate(&env);
    env.register_contract(&contract_addr, HelPhoneDao);

    HelPhoneDao::__constructor(env.clone(), admin.clone(), token.clone()).unwrap();

    assert_eq!(HelPhoneDao::get_admin(env.clone()), Some(admin));
    assert_eq!(HelPhoneDao::get_governance_token(env.clone()), Some(token));
    assert_eq!(HelPhoneDao::get_proposal_count(env.clone()), 0);
}

#[test]
fn governance_params_are_correct() {
    let env = Env::default();
    let (voting_period, execution_delay, quorum, pass_threshold) =
        HelPhoneDao::get_governance_params(env);

    assert_eq!(voting_period, 3 * 24 * 60 * 60); // 3 days
    assert_eq!(execution_delay, 48 * 60 * 60);
    assert_eq!(quorum, 20); // 20%
    assert_eq!(pass_threshold, 50); // 50%
}

#[test]
fn proposal_status_values() {
    assert_eq!(ProposalStatus::Active, ProposalStatus::Active);
    assert_eq!(ProposalStatus::Passed, ProposalStatus::Passed);
    assert_eq!(ProposalStatus::Failed, ProposalStatus::Failed);
    assert_eq!(ProposalStatus::Executed, ProposalStatus::Executed);
    assert_eq!(ProposalStatus::Cancelled, ProposalStatus::Cancelled);
    assert_eq!(ProposalStatus::Queued, ProposalStatus::Queued);
}

#[test]
fn queued_proposal_requires_security_threshold_to_cancel() {
    let (env, admin, token) = create_test_env();
    env.mock_all_auths();
    HelPhoneDao::__constructor(env.clone(), admin.clone(), token).unwrap();

    let guardian_a = Address::generate(&env);
    let guardian_b = Address::generate(&env);
    let mut guardians = SorobanVec::new(&env);
    guardians.push_back(guardian_a.clone());
    guardians.push_back(guardian_b.clone());
    HelPhoneDao::set_security_multisig(env.clone(), admin, guardians, 2).unwrap();

    let proposal_id = 7;
    let proposal = Proposal {
        id: proposal_id,
        proposer: guardian_a.clone(),
        title: String::from_str(&env, "upgrade"),
        description: String::from_str(&env, "test proposal"),
        proposal_type: ProposalType::General,
        status: ProposalStatus::Queued,
        created_at: 0,
        voting_starts: 0,
        voting_ends: 0,
        for_votes: 1,
        against_votes: 0,
        abstain_votes: 0,
        executable_payload: soroban_sdk::Bytes::new(&env),
    };
    env.storage()
        .persistent()
        .set(&DataKey::Proposal(proposal_id), &proposal);
    env.storage().persistent().set(
        &DataKey::Timelock(proposal_id),
        &TimelockState {
            queued_at: 0,
            execute_after: EXECUTION_DELAY_SECS,
        },
    );

    HelPhoneDao::approve_cancellation(env.clone(), guardian_a, proposal_id).unwrap();
    assert_eq!(
        HelPhoneDao::get_cancellation_approval_count(env.clone(), proposal_id),
        1
    );
    assert_eq!(
        HelPhoneDao::cancel_queued_proposal(env.clone(), proposal_id),
        Err(DaoError::InsufficientSecurityApprovals),
    );

    HelPhoneDao::approve_cancellation(env.clone(), guardian_b, proposal_id).unwrap();
    HelPhoneDao::cancel_queued_proposal(env.clone(), proposal_id).unwrap();
    assert_eq!(
        HelPhoneDao::get_proposal(env, proposal_id).unwrap().status,
        ProposalStatus::Cancelled,
    );
}

#[test]
fn security_multisig_rejects_duplicate_guardians_and_unreachable_threshold() {
    let (env, admin, token) = create_test_env();
    env.mock_all_auths();
    HelPhoneDao::__constructor(env.clone(), admin.clone(), token).unwrap();
    let guardian = Address::generate(&env);

    let mut duplicate = SorobanVec::new(&env);
    duplicate.push_back(guardian.clone());
    duplicate.push_back(guardian);
    assert_eq!(
        HelPhoneDao::set_security_multisig(env.clone(), admin.clone(), duplicate, 1),
        Err(DaoError::InvalidSecurityThreshold),
    );

    let one_key = SorobanVec::from_array(&env, [Address::generate(&env)]);
    assert_eq!(
        HelPhoneDao::set_security_multisig(env, admin, one_key, 2),
        Err(DaoError::InvalidSecurityThreshold),
    );
}

#[test]
fn vote_direction_values() {
    assert_eq!(VoteDirection::For, VoteDirection::For);
    assert_eq!(VoteDirection::Against, VoteDirection::Against);
    assert_eq!(VoteDirection::Abstain, VoteDirection::Abstain);
}

#[test]
fn proposal_type_values() {
    assert_eq!(ProposalType::ProtocolUpgrade, ProposalType::ProtocolUpgrade);
    assert_eq!(ProposalType::FundAllocation, ProposalType::FundAllocation);
    assert_eq!(ProposalType::ParameterChange, ProposalType::ParameterChange);
    assert_eq!(ProposalType::General, ProposalType::General);
}
