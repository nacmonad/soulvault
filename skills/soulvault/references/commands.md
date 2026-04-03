# SoulVault CLI Commands Reference

## Swarm
- `soulvault swarm create`
- `soulvault swarm list`
- `soulvault swarm use <name>`
- `soulvault swarm status`

## Membership
- `soulvault join request`
- `soulvault join approve <requestId>`
- `soulvault join reject <requestId> --reason <text>`
- `soulvault join cancel <requestId>`
- `soulvault member show <address>`
- `soulvault member remove <address>`

## Epoch / recovery
- `soulvault epoch rotate`
- `soulvault keygrant --member <address> --from-epoch <N>`

## Backup / restore / storage
- `soulvault backup request --reason <text> --deadline <unix-ts>`
- `soulvault backup push`
- `soulvault backup show`
- `soulvault restore pull`
- `soulvault storage publish`
- `soulvault storage fetch <locator>`

## Agent / identity
- `soulvault agent create`
- `soulvault agent status`
- `soulvault identity create-agent`
- `soulvault identity update`
- `soulvault identity show`
- `soulvault identity render-agenturi`

## Manifest / messaging / watch
- `soulvault manifest update`
- `soulvault msg post`
- `soulvault events watch`
