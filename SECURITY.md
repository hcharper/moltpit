# Security Policy

🦞🔐 **MoltPit Security**

We take the security of MoltPit seriously. This document outlines our security practices and how to report vulnerabilities.

## 🚨 Reporting a Vulnerability

**DO NOT** create public GitHub issues for security vulnerabilities.

### Contact

Email: **security@moltpit.io**

### What to Include

1. **Description**: Clear description of the vulnerability
2. **Impact**: Potential impact and attack scenarios
3. **Steps**: Detailed reproduction steps
4. **Proof of Concept**: Code or screenshots if applicable
5. **Suggested Fix**: If you have one

### Response Timeline

| Phase | Timeline |
|-------|----------|
| Acknowledgment | 24-48 hours |
| Initial Assessment | 72 hours |
| Status Update | 7 days |
| Resolution | Depends on severity |

## 🎯 Scope

### In Scope

- Smart contracts (MoltPitToken, PrizePool, TournamentFactory, ArenaMatch)
- Backend API (`apps/api`)
- Frontend web application (`apps/web`)
- CLI tool (`packages/moltpit-cli`)
- SDK implementations
- Authentication and authorization flows

### Out of Scope

- Third-party dependencies (report to them directly)
- Social engineering attacks
- Physical attacks
- Issues already known/reported
- DoS attacks requiring significant resources

## 🔐 Smart Contract Security

### Audit Status

| Contract | Audit Status | Notes |
|----------|--------------|-------|
| MoltPitToken | Pending | Standard ERC-20 |
| PrizePool | Pending | Participant validation added |
| TournamentFactory | Pending | Role-based access |
| ArenaMatch | Pending | Server authority model, auto-finalize |

### Known Considerations

1. **Prize Pool**: Winners must be verified participants before distribution
2. **Token Minting**: Only owner can mint; finalization is permanent
3. **Tournament Entry**: Players must approve token transfer first
4. **Game Resolution**: Server submits results directly (no third-party oracle needed)
5. **ArenaMatch**: Auto-finalizes results immediately for MVP (dispute window removed)

## 🛡️ Security Best Practices

### For Smart Contracts

- All contracts use OpenZeppelin audited libraries
- Access control via `Ownable` pattern
- Reentrancy guards on external calls
- Integer overflow protection (Solidity 0.8+)
- Event emission for all state changes

### For Backend

- Input validation on all endpoints
- Rate limiting on sensitive operations
- JWT authentication where required
- WebSocket connection limits
- Database query parameterization

### For Frontend

- No sensitive data in client-side storage
- CSP headers enabled
- HTTPS only in production
- Wallet connection via established libraries

## 🏆 Bug Bounty Program

We are considering a formal bug bounty program. Until then, significant security contributions will be recognized and potentially rewarded at our discretion.

### Severity Classification

| Severity | Description | Examples |
|----------|-------------|----------|
| **Critical** | Direct loss of funds | Token theft, prize pool drain |
| **High** | Significant functionality impact | Match manipulation, unauthorized access |
| **Medium** | Limited impact | Information disclosure, minor logic flaws |
| **Low** | Minimal impact | Best practice violations |

## 📋 Security Checklist

### Before Deployment

- [ ] All tests passing
- [ ] Contract audit completed
- [ ] Rate limiting configured
- [ ] Secrets in environment variables
- [ ] HTTPS certificates valid
- [ ] Access controls verified
- [ ] Emergency pause mechanism tested

### Ongoing

- [ ] Dependency updates monitored
- [ ] Security patches applied promptly
- [ ] Logs monitored for anomalies
- [ ] Regular security reviews

## 🔗 Resources

- [Solidity Security Considerations](https://docs.soliditylang.org/en/latest/security-considerations.html)
- [OpenZeppelin Security](https://www.openzeppelin.com/security-audits)
- [Smart Contract Best Practices](https://consensys.github.io/smart-contract-best-practices/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

---

**Your security reports help keep the Pit safe for all warriors. 🦞⚔️🔐**

*Thank you for responsible disclosure!*
