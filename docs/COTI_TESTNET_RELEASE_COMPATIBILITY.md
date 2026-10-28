# COTI Testnet Release Compatibility Matrix

This file is generated from exact local artifacts by `npm run verify:testnet-compatibility`.
It proves local compatibility, not remote configuration, wallet behavior, or release activation.

- Contracts candidate: `0xa4010f555ada10bbc118b517f648023dfa1ed2fe33d3965e3bece54f5e113285`
- Candidate attestation block: `9016632` / `0x461bcd5b8e169eac7cc67e3a5d2c4fc6b397f9357d00e41fef6ba666fe12e518`
- MCP runtime catalog: `0x081f564a48ef039f6f91b45d2aa9f8f2c543b519a83239b088409a23b61c92f9`
- Chain: `7082400` (COTI testnet)
- Candidate activation: `false`

## Consumer status

| Surface | Local authority | Local result | External release gate |
|---|---|---|---|
| Contracts | Unified candidate `0xa4010f555ada10bbc118b517f648023dfa1ed2fe33d3965e3bece54f5e113285` | 15/15 exact components | Candidate remains intentionally inactive |
| APP | Embedded candidate manifest | Exact hash/chain/RPC/finality match | Live wallet journeys and release activation |
| Worker/API | Runtime manifest environment | Exact parser boundary; no embedded candidate address | Deployment environment and live read-only rehearsal |
| MCP | Runtime catalog `0x081f564a48ef039f6f91b45d2aa9f8f2c543b519a83239b088409a23b61c92f9` | 15/15 identity/runtime/deployment matches | Independent catalog-hash review and signer canary |
| Supabase images | Compiled Direct/Group selectors and event topics | ABI exact; addresses remain deployment settings | Set and verify remote Direct/Group addresses |
| Supabase read cursors | Owner-forced RLS migration | Local migration contains owner and generation guards | Apply/lint remotely and run two-device isolation |
| Daily-price chart | Separate analytics authority | Store `0x2F23Fa612557D33e46c1d5B2510EF9fBc7f27067` exactly manifest-bound | Record the first finalized UTC close and verify automatic demo-to-live transition |

## Exact component graph

| Key | Contract | Address | Runtime hash | Deployment block | Consumers |
|---|---|---|---|---:|---|
| chatReactionsV1 | ChatReactionsV1 | `0x4bFE954De1dB0797892C9E1DF26AA4e21af9349e` | `0x4047e3fc8a39c16713d98fe4f0d0a933ca50ead11e2b0a1a6cc163ff2d6c5d8f` | 8982987 | APP, MCP |
| directChatV2 | ChainWhisperChatV2 | `0xE6B2933ac6407B678769a4Db2834E6257a21A02f` | `0x7ba5b1b9cfd675905cd70dc62ad81c841daf6f1ba95dab0738254a36256ca970` | 8981982 | APP, MCP, Supabase images |
| directOtcV2 | ChainWhisperDirectOTCEscrowV2 | `0x322e219B1275a99b556d852f425BFdc7900cAFCF` | `0x297a5796d584aaa7504a5c934270768cd5ba4f83e2926bbff6e95e7ca97d6ab7` | 8984225 | APP, MCP |
| groupChatV2 | ChainWhisperGroupChatV2 | `0xBeA25B6066e241FE6aE14fE53367Da01cFFdf787` | `0x608dedd00c5aeff7ec5f756395cd8269e24be50e9ae3da0f015c030963f88fd9` | 8982896 | APP, MCP, Supabase images |
| private-recurringOtcV2 | ChainWhisperPrivateRecurringOTCEscrowV2 | `0x86b515a2452B81A494AA21D9f3f44606DA93868e` | `0xa8f4471c5add7e7f1fce55e2d325510e258b6aa1b6e47ee22b4a5a29deccfade` | 8984235 | APP, MCP |
| privateLiquidityBookV2 | ChainWhisperPrivateLiquidityBookV2 | `0x034f5c24a4B9C28E861dDd1DD183E0BE10d818F9` | `0xc33f938f8110a1539a6041bfcace07777b03c8905dcf71e98884eaaf50d33b54` | 9000892 | APP, Worker/API, MCP |
| privateLiquidityHiddenIntentV2 | ChainWhisperPrivateLiquidityHiddenIntentModuleV2 | `0xee2488935880b9B25b20bf968e2d446474942271` | `0xae3fdfacb1eade48bd40506a09fffe5c22f4b37772c92a78e225762d41a90980` | 9000891 | APP, Worker/API, MCP |
| privateLiquidityPositionNftV2 | ChainWhisperPrivateLiquidityPositionNFTV2 | `0x2eE8B8D613d438DEE4df17da08Bb9F6826627335` | `0x8c0e39e24480b6c6657d67c750c2a0d7889afca0f364bc647c819c367f7d88bd` | 9000892 | APP, Worker/API, MCP |
| privateOtcV2 | ChainWhisperPrivateOTCEscrowV2 | `0xf4122D763d148C49956aA3A2704905904BC6900e` | `0xe20848f75e59634a16c7d33dd393e91698292a9b29400d456ff57ab0c04ac680` | 8984231 | APP, MCP |
| privateTestTokenA | ChainWhisperTestPrivateTokenV1 | `0x222381287eB9f5b3eEa825A3ca5B6c22c6C1893d` | `0x6418567abdfa4986b3f9607955e8834956014e8d7c9a6f859c4ff97083ef76ce` | 8984097 | APP, MCP |
| privateTestTokenB | ChainWhisperTestPrivateTokenV1 | `0x9467E348a5a4B415eA65e551785273E650ee5CA3` | `0x6418567abdfa4986b3f9607955e8834956014e8d7c9a6f859c4ff97083ef76ce` | 8984098 | APP, MCP |
| publicTestTokenA | ChainWhisperTestPublicTokenV1 | `0x5A3FAF1F6D53071832CccA03b9Ba72c00ecCDA18` | `0xf1167e8574d2cf5fa6ac185066eab5c7fe15fb4f65b6c7204e6adb1584247360` | 8984045 | APP, MCP |
| publicTestTokenB | ChainWhisperTestPublicTokenV1 | `0x90840aCDe1357F3C04055167192AaF90304237Ba` | `0xf1167e8574d2cf5fa6ac185066eab5c7fe15fb4f65b6c7204e6adb1584247360` | 8984046 | APP, MCP |
| recurringOtcV2 | ChainWhisperRecurringOTCEscrowV2 | `0xB609AE1cBA98E036c125f82ca62DE0E5990A06d9` | `0xaddc616c65b25791865088567005251d752bc02e26f8ce8236fbc067cad99b2f` | 8983977 | APP, MCP |
| standardOtcV2 | ChainWhisperStandardOTCEscrowV2 | `0x4980cb51E8A58F987FA4635E611c646792EA83f6` | `0xb610d2ae2b368287bcca3a9e40e1c3668b2654e87ccae7ecbb8316a1ec84d2df` | 8983966 | APP, MCP |

## Supabase Chat V2 deployment settings

- `DIRECT_CHAT_V2_ADDRESS=0xE6B2933ac6407B678769a4Db2834E6257a21A02f`
- `GROUP_CHAT_V2_ADDRESS=0xBeA25B6066e241FE6aE14fE53367Da01cFFdf787`
- Direct send selector: `0x9c37c00d`
- Group send selector: `0x67b2dfaa`
- Direct message topic: `0xc1b1cd53414aa748881be289567f95e4860fba25bed82b5ae31129f90b5f9e6a`
- Group message topic: `0xc179bb86b638762e8d9d1c349babf4f3ee84c2ef57188c590f4ad6ec281a09c8`

Remote values are deliberately reported as unverified until deployment tooling or a live read-only check proves them.
