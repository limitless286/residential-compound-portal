# Residential Compound Portal

Team 34 — Cloud Computing and Cloud Security.

## Team Responsibilities

 Youssef | Maintenance Management and shared authentication 
 Marwan | Facility Booking and transactional emails 
 Malek | Announcements and Service Fees 

## First-Time Setup — Windows

Skip installing any tool that is already installed and working.
The x64 download choices below apply to Intel and AMD computers.

### 1. Node.js

Runs the JavaScript backend. Includes npm for installing project dependencies.

Download: https://nodejs.org/en/download

Select Node.js 24.x, Windows, and x64.
Download the Windows Installer (.msi) and install using the default options.

Open a new PowerShell window and verify:

```powershell
node --version
npm --version
```

### 2. Git and GitHub

Git tracks code changes and synchronizes your work with GitHub.

Download: https://git-scm.com/downloads/win

Choose the x64 installer and install using the default options.

Verify:

```powershell
git --version
```

### 3. WSL

Windows Subsystem for Linux provides the Linux environment used by Docker.

Open Start, search for PowerShell, right-click it, and choose
"Run as administrator". Accept the Windows permission prompt.

Run:

```powershell
wsl --install --no-distribution
```

Wait for installation to finish. Save your work and restart if requested.

Verify in a new PowerShell window:

```powershell
wsl --version
```

Microsoft guide: https://learn.microsoft.com/en-us/windows/wsl/install

### 4. Docker Desktop

Runs Floci and the containers required by the local cloud environment.

Download: https://docs.docker.com/desktop/setup/install/windows-install/

For Intel and AMD computers, choose "Docker Desktop for Windows — x86_64".
During installation, select "Per-user installation" and "WSL 2".
Restart if requested.

Open Docker Desktop and wait until the engine is running.
Open a new PowerShell window and verify:

```powershell
docker --version
docker compose version
docker info
```

### 5. AWS CLI

Provides commands for interacting with the AWS services emulated by Floci.
A real AWS account is not required for this local setup.

Windows installer: https://awscli.amazonaws.com/AWSCLIV2.msi

Run the installer and complete the installation wizard.

Open a new PowerShell window and verify:

```powershell
aws --version
```

## Clone the Repository

Run these commands in PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\Projects"
cd "$env:USERPROFILE\Projects"
git clone https://github.com/limitless286/residential-compound-portal.git
cd residential-compound-portal
```

The Floci configuration is included in the repository.
You do not need to create it manually.

## Start Floci

Floci emulates AWS services on your computer.

Start Docker Desktop and wait for its engine to run.
From the repository root, run:

```powershell
docker compose -f infra/floci/docker-compose.yml up -d
```

The first run downloads the pinned Floci image and may take a few minutes.

Check the container:

```powershell
docker compose -f infra/floci/docker-compose.yml ps
```

Expected status: `Up` and `healthy`.

## Configure the Local AWS CLI Profile

Each runs these commands once on their own computer:

```powershell
aws configure set aws_access_key_id test --profile floci
aws configure set aws_secret_access_key test --profile floci
aws configure set region us-east-1 --profile floci
aws configure set endpoint_url http://localhost:4566 --profile floci
```

The value `test` is a dummy credential for the local emulator.

Verify the connection:

```powershell
aws sts get-caller-identity --profile floci --endpoint-url http://localhost:4566 --no-cli-pager
```

Expected account: `000000000000`.

## Stop Floci

From the repository root:

```powershell
docker compose -f infra/floci/docker-compose.yml down
```

Floci data is stored in a Docker volume.
Do not add `-v`: it deletes the project's Floci data volume.

Each developer has separate local emulator data.
GitHub shares source code and configuration, not local runtime data.

## Team Workflow

- Each one develops their component on a separate branch.
- Changes are reviewed through pull requests before merging into main.
- Each student uses their own Git identity and GitHub account.
- Never commit real credentials, API keys, tokens, or .env files.

## Current Status

The local Floci development environment is configured.
Shared authentication, database setup, and local service integration are implemented. Business workflows, frontend screens, and cloud deployment remain.

## Team Implementation Guide

See [Team handoff](docs/team-handoff.md) and [Shared contract](docs/shared-contract.md).

