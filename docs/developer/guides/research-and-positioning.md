# Research and Positioning

This is an English interpretation of the [2026-11-15 source review](../architecture/history/pre-english-20261115/docs/03-research-and-positioning.md). Its release/issue/API observations are historical, not freshly checked rankings. No comparative sshOS experiment or demand study has been completed.

## Product Focus

The design hypothesis is a coherent client desktop for existing SSH file/view/execute work, with visible server identity, independent windows, continuous progress and honest uncertainty. No server-specific installation or application DB is required. These choices do not establish unique features, lower memory, greater security or market demand.

| Related project | Relevance recorded in the original review |
| --- | --- |
| [Electerm](https://github.com/electerm/electerm) | Local SSH/SFTP/terminal/file workflows already exist |
| [Tabby](https://github.com/Eugeny/tabby) | GUI connection/terminal workflows; distinguish built-in and plugin features |
| [XPipe](https://github.com/xpipe-io/xpipe) | Existing SSH/shell-based connection/file workflows; open-core scope needs care |
| [Cockpit](https://cockpit-project.org/) | Web/bridge architecture; Client mode must not be described as always requiring preinstalled server packages |
| [WinSCP](https://winscp.net/eng/docs/ui_queue) | Persistent background queue/progress is baseline quality, not proof of differentiation |
| [Cyberduck](https://github.com/iterate-ch/cyberduck) | Existing cross-platform GUI file workflows |
| [Termix](https://github.com/Termix-SSH/Termix) | Both central-hosted and local-desktop architectures were recorded; do not charge every comparison a central-server requirement |
| [Capistrano](https://capistranorb.com/) | Explicit SSH deployment tooling is different from claiming universal rollback |

Licenses, release dates, issue states and feature versions must be rechecked at reuse/comparison time. Historical observations do not certify current maintenance or installation reliability. sshOS excludes remote GUI, editing, administration consoles and automatic repair to focus its first implementation.

## Research Interpretation

- Barrett et al., CSCW2004,[field studies](https://www.cs.cmu.edu/~15849g/readings/barrett04.pdf):administrator context and interruption motivate a context-preservation hypothesis, not proof that overlapping windows are superior for today's users.
- Voronkov et al., SOUPS2019,[firewall interfaces](https://www.usenix.org/conference/soups2019/presentation/voronkov):task-specific self-reported preferences are not universal GUI superiority or measured error-rate advantage.
- Velasquez/Durcikova, CHIMIT2008,[author bibliography](https://nicolefv.com/research):verification-information behavior motivates separating observed completion from inferred success; small exploratory work is not sshOS validation.
- Jenkins et al., CHI2024,[patching behavior](https://tulipslab.org/papers/jenkinsCHI2024.pdf):operational context informs honest permission/outcome boundaries, not exclusion of explicit commands.
- Neef/Wisiol, CANS2022,[SSHFP study](https://arxiv.org/abs/2208.08846):dated DNS measurements motivate explicit host trust without claiming current adoption rates or user behavior.
- Brown/Patterson, USENIX2003,[operator undo](https://www.usenix.org/conference/2003-usenix-annual-technical-conference/undo-operators-building-undoable-e-mail-store):application-specific undo prerequisites do not justify universal SSH rollback from a stop button.

These are design inferences from the cited studies. G0/G2/G3 remain [unperformed research](usability-evaluation.md). File/terminal/transfer co-location needs comparative task evidence; technical implementation does not prove adoption.
