2026-11-15T11:20:23.2946187Z Current runner version: '2.338.2'
2026-11-15T11:20:23.2971301Z ##[group]Runner Image Provisioner
2026-11-15T11:20:23.2972167Z Hosted Compute Agent
2026-11-15T11:20:23.2972832Z Version: 20261103.629
2026-11-15T11:20:23.2973465Z Commit: 15dbd9ccb5dbf34fae002b6ed1a2670f52df37bc
2026-11-15T11:20:23.2974184Z Build Date: 2026-11-03T17:26:59Z
2026-11-15T11:20:23.2974964Z Worker ID: {38d1ce5f-6461-46e8-8f5d-c03adea965cd}
2026-11-15T11:20:23.2975677Z Region: westcentralus
2026-11-15T11:20:23.2976271Z Cloud: Azure
2026-11-15T11:20:23.2976850Z ##[endgroup]
2026-11-15T11:20:23.2978299Z ##[group]Operating System
2026-11-15T11:20:23.2979407Z Ubuntu
2026-11-15T11:20:23.2979936Z 26.04.1
2026-11-15T11:20:23.2980478Z LTS
2026-11-15T11:20:23.2980993Z ##[endgroup]
2026-11-15T11:20:23.2981537Z ##[group]Runner Image
2026-11-15T11:20:23.2982227Z Image: ubuntu-26.04
2026-11-15T11:20:23.2982792Z Version: 20261111.196.1
2026-11-15T11:20:23.2984113Z Included Software: https://github.com/actions/runner-images/blob/ubuntu26/20261111.196/images/ubuntu/Ubuntu2604-Readme.md
2026-11-15T11:20:23.2985726Z Image Release: https://github.com/actions/runner-images/releases/tag/ubuntu26%2F20261111.196
2026-11-15T11:20:23.2986828Z ##[endgroup]
2026-11-15T11:20:23.2987960Z ##[group]GITHUB_TOKEN Permissions
2026-11-15T11:20:23.2990412Z Contents: read
2026-11-15T11:20:23.2991020Z Metadata: read
2026-11-15T11:20:23.2991554Z ##[endgroup]
2026-11-15T11:20:23.2993727Z Secret source: Actions
2026-11-15T11:20:23.2994631Z Cache mode: write
2026-11-15T11:20:23.2995750Z Prepare workflow directory
2026-11-15T11:20:23.3419788Z Prepare all required actions
2026-11-15T11:20:23.3467216Z Getting action download info
2026-11-15T11:20:23.6278622Z Download action repository 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683' (SHA:11bd71901bbe5b1630ceea73d27597364c9af683)
2026-11-15T11:20:24.0253211Z Download action repository 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020' (SHA:49933ea5288caeca8642d1e84afbd3f7d6820020)
2026-11-15T11:20:24.2331787Z Complete job name: planning-docs
2026-11-15T11:20:24.3247403Z ##[group]Run actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
2026-11-15T11:20:24.3248569Z with:
2026-11-15T11:20:24.3249255Z   persist-credentials: false
2026-11-15T11:20:24.3249851Z   repository: JunSungKang/sshos
2026-11-15T11:20:24.3253876Z   token: ***
2026-11-15T11:20:24.3254369Z   ssh-strict: true
2026-11-15T11:20:24.3254865Z   ssh-user: git
2026-11-15T11:20:24.3255341Z   clean: true
2026-11-15T11:20:24.3255844Z   sparse-checkout-cone-mode: true
2026-11-15T11:20:24.3256427Z   fetch-depth: 1
2026-11-15T11:20:24.3256852Z   fetch-tags: false
2026-11-15T11:20:24.3257294Z   show-progress: true
2026-11-15T11:20:24.3257741Z   lfs: false
2026-11-15T11:20:24.3258155Z   submodules: false
2026-11-15T11:20:24.3258622Z   set-safe-directory: true
2026-11-15T11:20:24.3259486Z ##[endgroup]
2026-11-15T11:20:26.4851008Z Syncing repository: JunSungKang/sshos
2026-11-15T11:20:26.4853392Z ##[group]Getting Git version info
2026-11-15T11:20:26.4854509Z Working directory is '/home/runner/work/sshos/sshos'
2026-11-15T11:20:26.4856805Z [command]/usr/bin/git version
2026-11-15T11:20:26.4976821Z git version 2.56.1
2026-11-15T11:20:26.4999620Z ##[endgroup]
2026-11-15T11:20:26.5016872Z Temporarily overriding HOME='/home/runner/work/_temp/4d3fdaf1-b03b-4634-8742-d4108366a17d' before making global git config changes
2026-11-15T11:20:26.5021142Z Adding repository directory to the temporary git global config as a safe directory
2026-11-15T11:20:26.5024582Z [command]/usr/bin/git config --global --add safe.directory /home/runner/work/sshos/sshos
2026-11-15T11:20:26.5428594Z Deleting the contents of '/home/runner/work/sshos/sshos'
2026-11-15T11:20:26.5432693Z ##[group]Initializing the repository
2026-11-15T11:20:26.5437916Z [command]/usr/bin/git init /home/runner/work/sshos/sshos
2026-11-15T11:20:26.5866590Z hint: Using 'master' as the name for the initial branch. This default branch name
2026-11-15T11:20:26.5869974Z hint: will change to "main" in Git 3.0. To configure the initial branch name
2026-11-15T11:20:26.5872986Z hint: to use in all of your new repositories, which will suppress this warning,
2026-11-15T11:20:26.5874958Z hint: call:
2026-11-15T11:20:26.5876045Z hint:
2026-11-15T11:20:26.5877379Z hint: 	git config --global init.defaultBranch <name>
2026-11-15T11:20:26.5879214Z hint:
2026-11-15T11:20:26.5880745Z hint: Names commonly chosen instead of 'master' are 'main', 'trunk' and
2026-11-15T11:20:26.5883263Z hint: 'development'. The just-created branch can be renamed via this command:
2026-11-15T11:20:26.5885422Z hint:
2026-11-15T11:20:26.5886554Z hint: 	git branch -m <name>
2026-11-15T11:20:26.5887890Z hint:
2026-11-15T11:20:26.5889894Z hint: Disable this message with "git config set advice.defaultBranchName false"
2026-11-15T11:20:26.5981618Z Initialized empty Git repository in /home/runner/work/sshos/sshos/.git/
2026-11-15T11:20:26.5994276Z [command]/usr/bin/git remote add origin https://github.com/JunSungKang/sshos
2026-11-15T11:20:26.6212972Z ##[endgroup]
2026-11-15T11:20:26.6215850Z ##[group]Disabling automatic garbage collection
2026-11-15T11:20:26.6217653Z [command]/usr/bin/git config --local gc.auto 0
2026-11-15T11:20:26.6252106Z ##[endgroup]
2026-11-15T11:20:26.6259218Z ##[group]Setting up auth
2026-11-15T11:20:26.6261194Z [command]/usr/bin/git config --local --name-only --get-regexp core\.sshCommand
2026-11-15T11:20:26.6297104Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'core\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :"
2026-11-15T11:20:26.8369986Z [command]/usr/bin/git config --local --name-only --get-regexp http\.https\:\/\/github\.com\/\.extraheader
2026-11-15T11:20:26.8409509Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'http\.https\:\/\/github\.com\/\.extraheader' && git config --local --unset-all 'http.https://github.com/.extraheader' || :"
2026-11-15T11:20:26.8685105Z [command]/usr/bin/git config --local http.https://github.com/.extraheader AUTHORIZATION: basic ***
2026-11-15T11:20:26.8724734Z ##[endgroup]
2026-11-15T11:20:26.8725370Z ##[group]Fetching the repository
2026-11-15T11:20:26.8734434Z [command]/usr/bin/git -c protocol.version=2 fetch --no-tags --prune --no-recurse-submodules --depth=1 origin +76473020b1b69b61c9c2b72024262a68f03af15b:refs/remotes/pull/1/merge
2026-11-15T11:20:28.3298550Z From https://github.com/JunSungKang/sshos
2026-11-15T11:20:28.3299843Z  * [new ref]         76473020b1b69b61c9c2b72024262a68f03af15b -> pull/1/merge
2026-11-15T11:20:28.3303373Z ##[endgroup]
2026-11-15T11:20:28.3304197Z ##[group]Determining the checkout info
2026-11-15T11:20:28.3305892Z ##[endgroup]
2026-11-15T11:20:28.3312072Z [command]/usr/bin/git sparse-checkout disable
2026-11-15T11:20:28.3485515Z [command]/usr/bin/git config --local --unset-all extensions.worktreeConfig
2026-11-15T11:20:28.3514453Z ##[group]Checking out the ref
2026-11-15T11:20:28.3518658Z [command]/usr/bin/git checkout --progress --force refs/remotes/pull/1/merge
2026-11-15T11:20:28.4511751Z Note: switching to 'refs/remotes/pull/1/merge'.
2026-11-15T11:20:28.4512486Z 
2026-11-15T11:20:28.4512949Z You are in 'detached HEAD' state. You can look around, make experimental
2026-11-15T11:20:28.4514074Z changes and commit them, and you can discard any commits you make in this
2026-11-15T11:20:28.4515225Z state without impacting any branches by switching back to a branch.
2026-11-15T11:20:28.4515823Z 
2026-11-15T11:20:28.4516264Z If you want to create a new branch to retain commits you create, you may
2026-11-15T11:20:28.4517195Z do so (now or later) by using -c with the switch command. Example:
2026-11-15T11:20:28.4517722Z 
2026-11-15T11:20:28.4517964Z   git switch -c <new-branch-name>
2026-11-15T11:20:28.4518330Z 
2026-11-15T11:20:28.4518556Z Or undo this operation with:
2026-11-15T11:20:28.4519152Z 
2026-11-15T11:20:28.4519351Z   git switch -
2026-11-15T11:20:28.4519631Z 
2026-11-15T11:20:28.4520093Z Turn off this advice by setting config variable advice.detachedHead to false
2026-11-15T11:20:28.4521152Z 
2026-11-15T11:20:28.4521844Z HEAD is now at 7647302 Merge da5cb45d59f6a6943bbd885cfd7960961b9625c4 into 609936e07db67734d204169801c251e8839ae4a4
2026-11-15T11:20:28.4563721Z ##[endgroup]
2026-11-15T11:20:28.4625534Z [command]/usr/bin/git log -1 --format=%H
2026-11-15T11:20:28.4652350Z 76473020b1b69b61c9c2b72024262a68f03af15b
2026-11-15T11:20:28.4662253Z ##[group]Removing auth
2026-11-15T11:20:28.4665467Z [command]/usr/bin/git config --local --name-only --get-regexp core\.sshCommand
2026-11-15T11:20:28.4696181Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'core\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :"
2026-11-15T11:20:28.4965695Z [command]/usr/bin/git config --local --name-only --get-regexp http\.https\:\/\/github\.com\/\.extraheader
2026-11-15T11:20:28.4988289Z http.https://github.com/.extraheader
2026-11-15T11:20:28.4996956Z [command]/usr/bin/git config --local --unset-all http.https://github.com/.extraheader
2026-11-15T11:20:28.5030436Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'http\.https\:\/\/github\.com\/\.extraheader' && git config --local --unset-all 'http.https://github.com/.extraheader' || :"
2026-11-15T11:20:28.5298213Z ##[endgroup]
2026-11-15T11:20:28.5553894Z ##[group]Run python3 -B docs/validate-plan.py --root "$GITHUB_WORKSPACE"
2026-11-15T11:20:28.5554545Z [36;1mpython3 -B docs/validate-plan.py --root "$GITHUB_WORKSPACE"[0m
2026-11-15T11:20:28.5605718Z shell: /usr/bin/bash -e {0}
2026-11-15T11:20:28.5606053Z ##[endgroup]
2026-11-15T11:20:28.6534510Z {
2026-11-15T11:20:28.6535176Z   "planning_valid": false,
2026-11-15T11:20:28.6535763Z   "version": "v6",
2026-11-15T11:20:28.6536282Z   "requirements": 38,
2026-11-15T11:20:28.6536795Z   "tasks": 13,
2026-11-15T11:20:28.6537262Z   "checks": 152,
2026-11-15T11:20:28.6537773Z   "required_technical_checks": 149,
2026-11-15T11:20:28.6538398Z   "nonblocking_research_checks": 3,
2026-11-15T11:20:28.6539361Z   "product_checks": "all untested",
2026-11-15T11:20:28.6539866Z   "planning_artifacts": 17,
2026-11-15T11:20:28.6540320Z   "local_links_checked": 84,
2026-11-15T11:20:28.6540793Z   "archived_file_hashes_verified": 69,
2026-11-15T11:20:28.6541579Z   "scope_digest": "22b572637f890232b8971d14d46ee72414bbbf2276360063f54c71365ce535cb",
2026-11-15T11:20:28.6542317Z   "errors": [
2026-11-15T11:20:28.6542716Z     "A01 stale hash README.md",
2026-11-15T11:20:28.6543193Z     "status stale hash README.md"
2026-11-15T11:20:28.6543640Z   ],
2026-11-15T11:20:28.6544326Z   "limitation": "Documentation consistency only; no product/runtime/security certification."
2026-11-15T11:20:28.6545114Z }
2026-11-15T11:20:28.6621003Z ##[error]Process completed with exit code 1.
2026-11-15T11:20:28.6794699Z Post job cleanup.
2026-11-15T11:20:28.7651941Z [command]/usr/bin/git version
2026-11-15T11:20:28.7697149Z git version 2.56.1
2026-11-15T11:20:28.7738410Z Temporarily overriding HOME='/home/runner/work/_temp/606948da-a910-425e-8d2c-4ea879ba048a' before making global git config changes
2026-11-15T11:20:28.7740252Z Adding repository directory to the temporary git global config as a safe directory
2026-11-15T11:20:28.7744862Z [command]/usr/bin/git config --global --add safe.directory /home/runner/work/sshos/sshos
2026-11-15T11:20:28.7785690Z [command]/usr/bin/git config --local --name-only --get-regexp core\.sshCommand
2026-11-15T11:20:28.7826258Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'core\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :"
2026-11-15T11:20:28.8173370Z [command]/usr/bin/git config --local --name-only --get-regexp http\.https\:\/\/github\.com\/\.extraheader
2026-11-15T11:20:28.8214217Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'http\.https\:\/\/github\.com\/\.extraheader' && git config --local --unset-all 'http.https://github.com/.extraheader' || :"
2026-11-15T11:20:28.8688322Z Cleaning up orphan processes
2026-11-15T11:20:28.9086840Z ##[warning]Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
