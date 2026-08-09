# Security scanning

The repository runs security and code-quality checks from `.github/workflows/security.yml` on pushes to `main`, pull requests, and manual workflow runs.

## Trivy

Two Trivy checks run automatically:

- **Repository scan**: vulnerabilities, secrets, and misconfigurations in the checked-out repository.
- **Container image scan**: builds the application image from `Dockerfile` and scans the resulting runtime image for vulnerabilities.

Both checks fail on fixable `HIGH` or `CRITICAL` findings.

## SonarQube

The SonarQube job uses the official SonarSource GitHub Action. Create the project in SonarQube first, then configure these GitHub repository settings:

| Type | Name | Value |
| --- | --- | --- |
| Variable | `SONAR_HOST_URL` | URL of the SonarQube server, for example `https://sonarqube.example.com` |
| Variable | `SONAR_PROJECT_KEY` | Project key configured in SonarQube |
| Secret | `SONAR_TOKEN` | Project analysis token generated in SonarQube |
| Secret, optional | `SONAR_ROOT_CERT` | PEM certificate when the SonarQube endpoint uses a private/internal CA |

Until the required settings are present, the SonarQube step is skipped and the workflow emits a notice instead of failing CI.

The scanner waits for the SonarQube quality gate and fails the job if the quality gate fails.

### SonarQube on a private network

A GitHub-hosted runner must be able to reach `SONAR_HOST_URL`. If SonarQube is only reachable over the home/private network or VPN, run the SonarQube job on a self-hosted GitHub Actions runner that has network access to the server, or provide a secure network path from the runner to SonarQube.
