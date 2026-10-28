import { AbiCoder, getAddress, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { STAGED_NATIVE_DEX_CANDIDATE } from './currentDexNativeCandidate';
import { STAGED_D06_DEX_CANDIDATE } from './currentDexC1Candidate';
import { STAGED_PREPARED_DEX_CANDIDATE } from './currentDexPreparedCandidate';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE } from './currentDexExitCandidate';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './currentDexHistoryCandidate';
export { STAGED_NATIVE_DEX_CANDIDATE } from './currentDexNativeCandidate';
export { STAGED_D06_DEX_CANDIDATE } from './currentDexC1Candidate';
export { STAGED_PREPARED_DEX_CANDIDATE } from './currentDexPreparedCandidate';
export { STAGED_EXIT_PREVIEW_DEX_CANDIDATE } from './currentDexExitCandidate';
export { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './currentDexHistoryCandidate';

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;
const COTI_TESTNET_CHAIN_ID = '7082400';
const UINT64_MAX = (1n << 64n) - 1n;

export const DEX_V2_ENV_KEYS = Object.freeze({
  enabled: 'VITE_CHAINWHISPER_DEX_V2_ENABLED',
  manifest: 'VITE_CHAINWHISPER_DEX_V2_MANIFEST',
  finalityLagBlocks: 'VITE_CHAINWHISPER_DEX_V2_FINALITY_LAG_BLOCKS',
  rpcUrl: 'VITE_CHAINWHISPER_DEX_V2_RPC_URL'
} as const);

export const DEX_V2_COMPONENT_KEYS = Object.freeze([
  'factory',
  'pool',
  'limit',
  'recurring',
  'swap',
  'core',
  'positionToken'
] as const);

// Exact shared-Pool trial deployment: unsigned package 1efdd9c5..., confirmed journal of 33 rows.
// This is a read identity only. It does not admit a transaction.
export const CURRENT_SHARED_POOL_CANDIDATE = Object.freeze({
  graph: 'b9efcb3d392cd259000635884f5f6a2167e28429d7f316ae90ee175d7c7c7a02',
  packageSha256: '1efdd9c5eabbc741a53b3d41acac39d095b5b3f7e81e39fd503cb81ddffa440b',
  chainId: '7082400',
  genesisHash: '0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a',
  core: '0xc36f1b8e3ed16a59c78b3d23ae1f7a48b96376df',
  releaseId: '0xda24bb25496a47044035abb1c4bc0d9f5112a2eed8a29deeb571bc6b2b40398d',
  marketId: '0x4f013b7939cedbeb4c73f31c3abc3e89f7c2f0be23a4ff6cdd3c7eb062215168',
  reviewedTokenSet: '0xb00d204f9af2370944ad8de6c1956f9421c00f84f7ba890d7860f85e13edf5ed',
  feePpm: 500,
  maxWorkLifetime: 900,
  tokens: Object.freeze(([
    ['0xbbafdc398697154e1de68780eafb0c586371cff2', '0x50ec5254aca88a9819cc819b1167c86bb8cba36916332c1c5a829b720da6d63b'],
    ['0x96d97450d36eb65804ce2f84d0fe6c9ef52f264a', '0x50ec5254aca88a9819cc819b1167c86bb8cba36916332c1c5a829b720da6d63b']
  ] as const).map(row => Object.freeze(row))),
  runtimes: Object.freeze(([
    ['ChainWhisperRangeWork', '0xe8fa8f83c08337e8934c290b0b8c495b754fee22', '0x74843f536b211e8aa5741b9894139e135dd0c2464b6a589baf41eaa69706d06d'],
    ['ChainWhisperOrderWork', '0x7dc9e1ad5f2486ec81500d30a7a26d5b4e973975', '0x58f5849be36a703e26b76485cd4564e02adced482f1050cb3476d94f3ab15bbd'],
    ['ChainWhisperRecurringOwnerControls', '0x00d4cb09f50626f6968bd498749f2424e3c9c9fe', '0xee1a9d0d109d23a800856dc5e200a6d7e9400f4793df9ed97fc696f2da5308f3'],
    ['ChainWhisperFixedOwner', '0x543177462bb93b089ae1e73c9ad53b9cce15f7d2', '0x40e133921bb8e6c2d35f6b21104d6b0980988094c12f23deb311a53e83f77654'],
    ['ChainWhisperOrderOwnerLifecycle', '0x621da4be10180f37573960fbe53c76e499ea21e2', '0x726757dd7af6e11c22c63f94a4971678a113bbac176444935b0a2be8754f263b'],
    ['ChainWhisperRangeOwner', '0x2c0e344414c9fbb355b4b21b7bc25e664d45b4d5', '0x04bb27ff7fd85f085ee7d19d36c77711d0af8c9f287bbbcdc2fa517d0ecf2003'],
    ['ChainWhisperFixedWorkLifecycle', '0x7c67955d14c12b40a79e1f8a8e199fc70b7ae142', '0x075d6c351f89337d5f88e1dba30eff0902fc3d3228e632025d3ed1472006e392'],
    ['ChainWhisperFixedProtectedRatio', '0x64002317bc7d72775f5cee9af13184ee2ac64807', '0xc9c92f2de2787403ad4d3a7d5316cad82e625c6fc954c002189db807b20e481f'],
    ['ChainWhisperFixedSelectorMath', '0x36ca47ac5978591cb2886ff741ba6582ce579bf7', '0x370a04c1d1caeb82a529255655da11a40f45b77c73b30688327cd450a5f48860'],
    ['ChainWhisperFixedBoundedSelector', '0x96201c833e9d0f7fe651cd6c176f8fb2cbbe792d', '0xc974a4be35101f75a699e2b9c4e0384185539f9871d3b6bba3bbcc1e902ea088'],
    ['ChainWhisperConcentratedQ96Module', '0xc6c42e92a685a8177925991805ccba7991845bbb', '0x9d0cee597bf02536dd93caaee9c8b0af985247e7d6a84e73bb37515820f17d7b'],
    ['ChainWhisperSinglePassAllocationGT', '0x8e4555b7fdc40e09e0082e08ea1f28b973dfa64e', '0xf04c8a10856ea849b9950412f4843f715b56cd4e4d4fb11340e0fa0a3457d939'],
    ['ChainWhisperConcentratedPoolQuoteModule', '0xe681c0d63df198dc17b9a2d9894a4b21081add44', '0xb37864f78de65e09cd4cf05aa4756037bebdbbc56338418066bd5c9deb52d79b'],
    ['ChainWhisperDexPoolWorkLibrary', '0xc496f3e1bd7a418e8f6cbcc69446a4213b724374', '0x9a610ce0070667e4f3e37053d4d198fba9dfcad08a2c49583270a3fee867bdce'],
    ['ChainWhisperDexJointWorkLibrary', '0x5c1cdde7d390ec6626d5e3d57b13e4b8e986120a', '0xd9af3abd612b5742af9e88ca5f8c6dffa5457d379ea5f62aae0c726c94d0e7c6'],
    ['ChainWhisperDexReceiptAccess', '0x7c2b1a07fa86026517568a7662f059e176470d30', '0x74d619cb353d97b9e46d578e0ddceb594e756a3e8c4fdb9ee4356ce913a36e99'],
    ['ChainWhisperDexJointSettlement', '0xd70c4e2e25a31ebbf74ca898b5befcd436e3f47f', '0x7a4e102ea26739590bf8ed4605fbe391f72b2d7f11fb87a6349902ae72432748'],
    ['ChainWhisperPoolOwner', '0x57a95859b76cae871189d7ce2d9e2ae0c0b27b51', '0x5c2a5ae8dc2fd8732d8084e88f041578dd9826f04bb8af3b06cfefcc3ef3a70c'],
    ['ChainWhisperDexOperationRelease', '0xdcec255a431c74b716d8e2a41b979436e8215ad2', '0x1e3b86323419624efd083364213e6dd1faca587a54226b06030edb257d0ed65d'],
    ['ChainWhisperDexOperationSettlement', '0xa255b18be71041e6ad192b0f434e3460ad460aed', '0xa285b771d8cb1a696eafa54863d81e72b3285da777a869c644f212bd03e9a1d3'],
    ['ChainWhisperDexSwapAdmission', '0x1bfe4234b7428678528e0ef5f5ce2de3088699a4', '0x6b2456328f5051eb01cdb3b0e11131809d2d2266b4f900da390831c2f0aeeb79'],
    ['ChainWhisperDexWorkLibrary', '0xa98797c6c4d66a4fb6c701ac77885073608275db', '0xb474c6e3cf10ae2ea045be9874504096f25c49c568a41107a69095f8b07e6ca3'],
    ['ChainWhisperDexOperationLifecycle', '0x2b4c577d09af38942fff1b8325d017c27d4a6c76', '0x411a736464711593ccab8a31374b8fb529921dee66e58e51e79321422b65be77'],
    ['ChainWhisperFixedPositionAdmission', '0x6f18baa0ac4890105280eadada46c091b911ee83', '0xf6169a55eaef764fa39abe20f182a8b3e6bdfbc0c6f245c9e92b597af0b1415f'],
    ['ChainWhisperSharedPoolClaims', '0x93b4a11384b1b550fd1d366e0d52132f0004ea7c', '0x9cd7b187f8da50ed78b176939a46f0aea5f34f263c12299ddbd605d91fbab5eb'],
    ['ChainWhisperDexPositionCommands', '0x046e7ae6c966112c68f4a550ec65599e68fbaec4', '0x43e9da0ad0878b337fbe6eb5f89256273009f27122640be8de9306c86ec36654'],
    ['ChainWhisperSharedPoolMathDeployer', '0x1eec7cd6abfd074d40d558c01d78c9e656880154', '0x7a7ea21171f874cef7d09d32b87997bec16f8303548a98e1ea47a4b62aa07609'],
    ['ChainWhisperPoolTermsDeployer', '0x916e6a40f5ce8620822c001458654b0bdeba4370', '0xb6fdb2ad24d77184e23ea3c422c5c9e28480e11545e05ecf70967884095a43a2'],
    ['ChainWhisperRangeAllocationWork', '0x8fb96875bb509cc1115e780bfb5d0a876c4e50bd', '0xb2fb099c3acfaf81ba0007acacb6b79c784c33309a60e18bbe9b8e6a905c3965'],
    ['ChainWhisperCreationChunk', '0x18eb5c6da50ea4b88395e301de23a9b5709536cc', '0xe389bed8bef46969c79fb72e6264dde946bdfce54ba4f4dd8e09343dc5f78d17'],
    ['ChainWhisperCreationChunk', '0xe62e3cf9d2b23d25514dc6150ff69bbbb2e8bf44', '0xd4356ae56443c9e2246a51f2d29c67a38ecdffb0ed63be63a810e105eac24228'],
    ['ChainWhisperFixedEngineFactory', '0xb93ab235dd5c435abf77e49561c8e0bde3cbfc9f', '0x6af8b9f68d32c2120e36b44f00eff6106fa2d150939ba80d29baaa622452c4c4'],
    ['ChainWhisperDexCore', '0xc36f1b8e3ed16a59c78b3d23ae1f7a48b96376df', '0x6457590b15422bcc5e1e96cfd9e22562da00ccc37a845e756ba5dd6e022b1411']
  ] as const).map(row => Object.freeze(row)))
});

// Current 04ea deployment read identity from the frozen package and attestation.
// It does not admit signing, broadcasting or a swap.
export const ARCHIVED_CHEAP_DEX_CANDIDATE = Object.freeze({
  graph: '04ea108dd247d39d1158a0c441ddd9119efe05de5c9217b38c2a3d048944c1fc',
  packageSha256: 'c7a2afd6c6dcd9b72129dfc62fb5285965e83cf547ac1ca972ed8b6d56a3a7ad',
  chainId: '7082400',
  genesisHash: '0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a',
  core: '0xa2b718d9f3f086e9eecee9015dcb037f7a10b0e7',
  releaseId: '0xda24bb25496a47044035abb1c4bc0d9f5112a2eed8a29deeb571bc6b2b40398d',
  marketId: '0x4f013b7939cedbeb4c73f31c3abc3e89f7c2f0be23a4ff6cdd3c7eb062215168',
  reviewedTokenSet: '0xb00d204f9af2370944ad8de6c1956f9421c00f84f7ba890d7860f85e13edf5ed',
  feePpm: 500,
  maxWorkLifetime: 900,
  attestationSha256: '2649ab586f98670564623fa3104885214c04764c0322413da396633bb798ebdf',
  readyToSign: false as const,
  attestationBlock: Object.freeze({ number: '9862958', hash: '0xd03fac96e54e133f423211f74ac530b83729d4215cd2dd431359dafd5432b52c' }),
  tokens: Object.freeze(([
    ['0xbbafdc398697154e1de68780eafb0c586371cff2', '0x50ec5254aca88a9819cc819b1167c86bb8cba36916332c1c5a829b720da6d63b'],
    ['0x96d97450d36eb65804ce2f84d0fe6c9ef52f264a', '0x50ec5254aca88a9819cc819b1167c86bb8cba36916332c1c5a829b720da6d63b'],
  ] as const).map(row => Object.freeze(row))),
  runtimes: Object.freeze(([
    ['ChainWhisperRangeWork', '0x72d98635898f3e32ee92b56c3b1192df9b311849', '0xb9d4908362332b1209b05719d2fc47346f032241d860facd4d944eb5fdd56f17'],
    ['ChainWhisperOrderWork', '0xf16170ed1332fc16aeb50b9a11ccba4a47768b28', '0xb6a48121376d28418ce522771fc48951446811cf0c70cb097bd5f06de5ff73a7'],
    ['ChainWhisperRecurringOwnerControls', '0xe1359a1427901edd90e7e2697f30f2a9e753d0bd', '0x7293910444db940f29bc26d64496e5030ccb2e5e8713d1c980d57620240ec137'],
    ['ChainWhisperFixedOwner', '0x2d7d320c95c67d2f120299b980fe8cd882cda9f3', '0x631602aad27a760072a13593c5b7bc5820d5b0ea9372730f638e30e3c8d5e2bd'],
    ['ChainWhisperOrderOwnerLifecycle', '0x7f6dd9ed72e1c30e4d359a1729158bc1f4a8dd87', '0x12550f8aa83b02bfc440aaf79b4d19f221636ce88a28d51618c6995baa7883a4'],
    ['ChainWhisperRangeOwner', '0x3de381e90ca1f62aa40b378e5ccac5f99e23a77d', '0x006105e7b5b3e65857a0660e505eaa31e4c8f69d7f4f97ed12f477b87d0ea756'],
    ['ChainWhisperFixedWorkLifecycle', '0xe2797cb73c6a385fc8e6c56280469b64a7abe4b2', '0x8b3c8b5ad0e8cfd96942b9e3e5b4a7367b5146dd50c5ff3f2dd1dc5bcfd0c7bf'],
    ['ChainWhisperFixedProtectedRatio', '0xdb203fcfb9a598c41549a7b653e522e7d7b52074', '0xc9c92f2de2787403ad4d3a7d5316cad82e625c6fc954c002189db807b20e481f'],
    ['ChainWhisperFixedSelectorMath', '0x1a7b87fc266c451b3dece8a1cdf640795107dd65', '0x7ca5baf945f412c79a9037cd42345dcfa826f1b64bda4f4e7c23c6bccee9a2f0'],
    ['ChainWhisperFixedBoundedSelector', '0x794bd43f805ad21dbc5af020d403434118400949', '0x99dc0fbd482481a9365df48bfe98ad29286fdde26eae5bebe19a6983902d7e43'],
    ['ChainWhisperConcentratedQ96Module', '0x1f8547ecc2b21eae34b32ce2a4ced20494643824', '0xcf02e0066be487931ad91c22a0c21e180d54fb5dba6821268f7bb3d7c6f55bd8'],
    ['ChainWhisperSinglePassAllocationGT', '0x043680236ba1b28dcc1dbfe0be049e31ea169cd7', '0xd5f007fd94e7560778cac609f9e795fd0510f2d521d484bdf6a2a8c70f7fcacb'],
    ['ChainWhisperConcentratedPoolQuoteModule', '0xea87d10a6b0a421d2912ef0df22055d8f0e7bf27', '0x997067378130fd4ed50aae893fd1178a8de060067b6ef903e3b7e7d60278317e'],
    ['ChainWhisperDexReceiptAccess', '0x548018d2132c179cb3a2e7e511d833c93ba6b5d0', '0x02e36d84390642cc6bcd06dc72b960d920364843ebca935219209d8ede377979'],
    ['ChainWhisperDexCheapAsyncQuote', '0x84542069c0179d399fb723bc30559755369fa5a7', '0x1c98784fde515a1fc2a403723a1c88e347e456f5c2c8990d10aec31d7aaf840d'],
    ['ChainWhisperPoolOwner', '0x5793a438eba633b9c8b945cb07985dc7918d19e9', '0x3aac6c4e3c77fd50a2920cc59eaf454a5ef392be99d49f38c797c119d71ac5cd'],
    ['ChainWhisperDexCheapAsyncTerminal', '0x523544247dfe9b3e5538bf65dbd23939721cd20e', '0x541fb35116197d213fbfc11af6ec92a0237022512ffba8fadce832f145409b42'],
    ['ChainWhisperDexCheapAsyncRouter', '0x549e096983e9a7fb346b3de67375e5ab09faa350', '0x0aef279c425104cbef40cdd5c3d4e2627ae153ac91a19f882f7bdd2776dfd164'],
    ['ChainWhisperDexFastPoolLifecycle', '0xb0924072fcb4ca6239951585b0905748ffeab6ff', '0xd1cee82c67970c773e33ffdd1699200791d0fc59e7cb3e2e59500500c07d9138'],
    ['ChainWhisperDexFastPoolSettlement', '0x573d203217ea0e8f39c98df828b87292870f0bf2', '0x760a2812caf4f608f2ba8ddab7e460ed117a15d9320a8986e54e179eb835af2e'],
    ['ChainWhisperDexPoolWorkLibrary', '0x7eac9688411cf5b307d9a9ca9319a7c09a311384', '0xaf7d27eff5a01468696cab8e5cea6ed75098baafc656b2eea37407a90eceb30d'],
    ['ChainWhisperDexJointWorkLibrary', '0x67277f99c84d96f6bf4153b21403129922bc658b', '0xf29ec3cbfe7112582f0b6ff4b71f6d7b676bf163eb7b280dd3d9ccfee7f97feb'],
    ['ChainWhisperDexJointSettlement', '0x1e73629c4b16ee6e94cbe3540a2cf030e1a48858', '0xf82a0b5cd80c25c0b65ea1ce34a02e3e0b3068ea9a6be86081c79c800c6ddcdd'],
    ['ChainWhisperDexLimitMatchSettlement', '0x33b995d3509cf23025b26729f1280026133aed75', '0xee25b946263b7e6ef6cf82bae822dd3a19a9d758f3df98997337712254452a9f'],
    ['ChainWhisperDexOperationRelease', '0x064e5dda2110e9edaaad0808dcde1415ddff6116', '0x6e3a979f640c02b15bb7a5215d10c9ed56d6c97c8ab5f88c852465190c0d3bee'],
    ['ChainWhisperDexOperationSettlement', '0x461411f5fb69053269ef1049b8654c8a1dc6f01f', '0x361060efd820e5b59b35769fe09ef4746368098b8f10fa8baec868021924bb30'],
    ['ChainWhisperDexSwapAdmission', '0x6829c939b0fc6e3a2bac7e699fa01e3f22268b02', '0xc09f41c34391bbc2fd776261304e55d88b764032aa13ab0a731f527089a814d8'],
    ['ChainWhisperDexWorkLibrary', '0x08ce3bc462df4ac765c279c76fe7708b72a21a9e', '0xd405ad585d274bf036a2bf395096efd4cf0d6bfd782cddaef037dbb8792eaa17'],
    ['ChainWhisperDexOperationLifecycle', '0x4223ef48f3ecca13be65b8f7409eed84ef6ebef9', '0xcbad491e1f8033cccd34e38822aedba75b19022caa2080b0004a6bdf6ee512da'],
    ['ChainWhisperFixedPositionAdmission', '0xac3b476c2ddb49ab49c8f72dc2f89fc74cb338ea', '0x86361940857e146383d18c36a61418aa993cec876fae8aa2cf22465c4574b225'],
    ['ChainWhisperSharedPoolClaims', '0x46e9b8a261ed89f1126736dd44ef02c845a52477', '0xa8d56dca60d47bc7052aae5fc94989bd0d682c0f354f4efe14436653ae29de7f'],
    ['ChainWhisperDexPositionCommands', '0x40909ccd807ea07e56238a3277a06a1e3efab64f', '0xc71816ff99a3fe6aee2488a2fd31bd78d82aeb29bd513acbbaf87f991b17c822'],
    ['ChainWhisperFixedMatchWork', '0xa91086e1fa0f712310dd8e56577aa85a8235a023', '0xba4b79e558ebec9e5651186e77af37bd981ef154bc4e1024439957f88e77466f'],
    ['ChainWhisperSharedPoolMathDeployer', '0xefbc494581053dbfbd0056d318c9c19ad3682875', '0x9f34be953d49c911a0695304e24943f573c01acd555a759672e9368b156328ac'],
    ['ChainWhisperPoolTermsDeployer', '0x0afba51420cf109ad2067f198afc40fbb4966eb5', '0x54c909018c49e7b782f9ab9883f740466a40a4ad8d2696f7671625999acba1f1'],
    ['ChainWhisperRangeAllocationWork', '0x819c3295d0afe9cfd41737db39345244058ba07f', '0x49d50bf4b75630bf913dddca4391e75e833f535ad1b08ad510260f403011ef77'],
    ['ChainWhisperCreationChunk', '0x8104c31ae989ad3b6e3da5c01b666f63484a74b2', '0x4e34654771df5307e595ee25bc3decff7dfc405c61bf146cb01682a91525814a'],
    ['ChainWhisperCreationChunk', '0x801c6902e3a9d8c4c58cd9be24c8a8c4e20e7b3b', '0x633fe4b732eb515626d9be9c2551abb266f897e0042d117acaa5e7a03b59adbf'],
    ['ChainWhisperFixedEngineFactory', '0x9936370a2b99689f60b476bfdecb8a2f62105ea7', '0xe3150e8d4358cc2a63ff12ee0a71b982532937f4b68f19880daf3d9c9206761d'],
    ['ChainWhisperDexCore', '0xa2b718d9f3f086e9eecee9015dcb037f7a10b0e7', '0xd6e128469ccd62aae45ada2cbf86f9e4aeb9916011b489623f756689b6bfed73'],
  ] as const).map(row => Object.freeze(row))),
  companions: Object.freeze(([
    ['ChainWhisperFixedEngine', '0x4386a847d61af6049ada32869ef2b19a6a632536', '0xfb2ed20866671f90bfbb812221e71fa78f9d8935be3277449a037465e38b4920'],
    ['ChainWhisperDexPositionNFT', '0x22a9842614db8535a721d6e2fc6c4f29196774e9', '0x5da34c6dd32535900e5947833ff700e869c10c011765331728f9875762537332'],
    ['ChainWhisperDexFastPoolQuote', '0xd8a16eebba45ba2b9ac4c1d2a1cb4e15193e1bee', '0x0d5933fe3f17622282d7584cf6e56d00cc4ddf5d06d4bdd18564a8554c17c236'],
    ['ChainWhisperDexWideTerminalGT', '0xd8d24c9d676686c2230b5bccfd357af5f5f4480c', '0xe088daddd85a1bbe1e50982a4e7504a4b2f84096430389ff54452ded7ca7918e'],
  ] as const).map(row => Object.freeze(row))),
  evaluatorBinding: '0xad4d1b64a71564d51e314c56634deb7db38b043f9590a77621d320a7b01392e3',
  poolTerms: '0xb4bdc9b0ed2db950455fb35fbbf8c72f459c9c2d',
  factoryStorage: Object.freeze(([
    ['5', '0x0000000000000000000000008104c31ae989ad3b6e3da5c01b666f63484a74b2'],
    ['6', '0x000000000000000000000000801c6902e3a9d8c4c58cd9be24c8a8c4e20e7b3b'],
    ['7', '0x00000000000000000000000000000000000000000000000000000000000086a4'],
    ['10', '0x000000000000000000000000a2b718d9f3f086e9eecee9015dcb037f7a10b0e7'],
  ] as const).map(row => Object.freeze(row))),
});

// Staged identity only. This record does not change the active deployment or admit writes.
type WidenCandidate<T> = T extends string ? string : T extends number ? number
  : T extends object ? { readonly [K in keyof T]: WidenCandidate<T[K]> } : T;
export type CurrentCheapDexCandidate = WidenCandidate<typeof ARCHIVED_CHEAP_DEX_CANDIDATE>;
export const STAGED_QUOTE_SLIPPAGE_IDENTITY = Object.freeze({
  graph: 'ed09cf998c046cc1bf629d5965936689cfa38902de13c684cf65f2967652945e',
  artifactSha256: 'a60a5e2e3d1536a673547fb70a9743093f8204c4cae6d64c032e4eedbb33a911',
  packageSha256: 'bf02736ae4e1da5365576835fa4007495c47dcdb39ce53c76837c9753a999327',
  core: '0x683a0f8482507bf21fd7ac098df769f2d80e00fa'
});
export const STAGED_QUOTE_SLIPPAGE_CANDIDATE = Object.freeze({
  ...ARCHIVED_CHEAP_DEX_CANDIDATE,
  graph: STAGED_QUOTE_SLIPPAGE_IDENTITY.graph,
  packageSha256: STAGED_QUOTE_SLIPPAGE_IDENTITY.packageSha256,
  core: STAGED_QUOTE_SLIPPAGE_IDENTITY.core,
  attestationSha256: 'efc96f3badd9d79f77dd6b3c8e4c6f3df93bc07919b49ea27bcb8dffa7b3a6a2',
  attestationBlock: Object.freeze({ number: '9885451', hash: '0xffd55a0324320d7f787cbae12d12bffa6c78b35d9ac537db6b27787d66eff182' }),
  runtimes: Object.freeze(([
    ["ChainWhisperRangeWork","0x7dbd79c1a34ff9666a1290c17e775018c5544031","0x80e45fc54139d8884f32f3bfaaacb5b9f386371b2ccfa4d08bb56b15d6ef7ae2"],
    ["ChainWhisperOrderWork","0x1c205251d147f8728e0c71b128af690f480a11f5","0x6b764fd51faff2a41d43ff5103b35728f7d50dca1221bdcd4ada22add72e7ee7"],
    ["ChainWhisperRecurringOwnerControls","0x6481cf9abdcff38495328a30a8f7d262dcc57c50","0x2277252ac115e9b4d54d8d63b44769481732d5c18ace504593971ba73e804f90"],
    ["ChainWhisperFixedOwner","0xfe29dc9dd2253c854187c60e5137b5c37fb15554","0x9c1e0f21c55ccc7f6dcf3a9f558730952f5f0751471f4f5eba774f99e675a57d"],
    ["ChainWhisperOrderOwnerLifecycle","0xe567c46b26c4f18d237b469a6e6da57a9f25a28c","0xd69c831785b5fca24c15bf57561782fe83d366c9b90699bc999c1a404a14ccc4"],
    ["ChainWhisperRangeOwner","0x783fc812a58b9fb3777eeb3d0c63e7dfebf2901e","0xd78dbcc2d43f017d923444f48aed0385d7ff6d4555d15015936ac72a71586f36"],
    ["ChainWhisperFixedWorkLifecycle","0x8142566c7500799e3a84fcbd7eaddb31b919ac74","0x7cb23142a510ef8a3af9b365750b6464593781c847be945fe00a2d79109256f0"],
    ["ChainWhisperFixedProtectedRatio","0x5a71c5e10deb8cd50d474a4f50bb06d4336c3751","0xc9c92f2de2787403ad4d3a7d5316cad82e625c6fc954c002189db807b20e481f"],
    ["ChainWhisperFixedSelectorMath","0x7b8664278444af66a60d1ab7e637d7f03f8cb293","0x6391b6a93e3dd9134946f456e4ddf1d0c0d519a159a7fc451c92096716c1985a"],
    ["ChainWhisperFixedBoundedSelector","0x7672e83f184c0678ae599843cb3369edfa349b78","0x3213992c3d0476a2fbd61d03cf9e31d4dd397b9d898cf5156dc8577f9f9023eb"],
    ["ChainWhisperConcentratedQ96Module","0xcb6da9acefe71a00ce5de8d8bfce8bb0ab3bd8bc","0x67c403b95d7469ef23279de941c712da1ae952c052276b918e202d1b7ab79189"],
    ["ChainWhisperSinglePassAllocationGT","0xf524515126b6440966ef725b88674c6a538b01a7","0x05ec216a248784578c170cd5c2314bb8ab3e769b8fdb813b60da8ed8aa2c77b2"],
    ["ChainWhisperConcentratedPoolQuoteModule","0x653240e0914f62c9199e1b49ea62f3c72cd96037","0xd4c6d549d3d6e1c4f57e1d88c6217f1c97a085a736e33e8cffa1d64653d07f56"],
    ["ChainWhisperDexReceiptAccess","0xc050d0488fc588deb8e7089fe9130ebc7a2ef11a","0xb7e026794f74fa3daa897282bdb1635400bfa62601ae7bd285e2c4632b5a2d43"],
    ["ChainWhisperDexCheapAsyncQuote","0xd51f2d63db49c50586ed2dde787409f8d9b169ca","0x1f1898f1f9465632292e2561c0e4a17683ddf667e26b62cd79fb7056143ba89e"],
    ["ChainWhisperPoolOwner","0x83000463c9beeba29ef822bf6b5c337f957bf939","0xa360d1e4db8bb86103c7eb4079abc0b3932260fc1bdd55c62906fcc4f7f5e5fc"],
    ["ChainWhisperDexCheapAsyncTerminal","0x761088d74aedfc253cf530b1a4f8091b37da84c4","0x8561bd31ac4e5d83762b8a94cf852a55c3548dbc8098b5492468c65a309ae318"],
    ["ChainWhisperDexCheapAsyncRouter","0xe412592a4204443336e784ac6754a3816f3c7890","0x33f9029defbd85be8027233070a9feadf1981dd02b001a2c49683c2a1b360f06"],
    ["ChainWhisperDexFastPoolLifecycle","0x4d1bcf8c75cc225116b20073cc4fcfa6a737b53c","0xf1710829adea01a184318470a1d2903c2b5b438111de03052622175a67c52b48"],
    ["ChainWhisperDexFastPoolSettlement","0x4fc8e4a61457f88afbb36966c903d112a5a4a83a","0x63356d91ad3933a5882bad386a3941079409398bd4713fea2c6620e1a222e56d"],
    ["ChainWhisperDexPoolWorkLibrary","0x911d6c98585b7cd5d009b521d30e8a486aba8237","0xa4a268ed57eda93fbe122589b014914dcf08fec28469ad4b45d9df0d3fe3ed9c"],
    ["ChainWhisperDexJointWorkLibrary","0x25319f99004c725c2158ee0010f8c916d4ce8c81","0xff1855265a73c0bea89ea2b09d41051c3b38f4d65e8d1d2aa82b974bc204b6b6"],
    ["ChainWhisperDexJointSettlement","0x501192d083bdebf7299b2166958d27d6876d1f97","0x7a812a3568cf85fdd85409bdc1ba6b2cfd9484e2e2df237f6126dcefff47f082"],
    ["ChainWhisperDexLimitMatchSettlement","0x585ae8cf12825674b17ce31c19f8bcc7187cb419","0x57689b64acf4ee2b6c4902fbdf922f74a57b9635c1f85f8d2bcbd45d2d743c23"],
    ["ChainWhisperDexOperationRelease","0x5469aff2e6abd98b3cb2eb29febab32c7dd0cd9f","0xa9b90fe826d9ab857cc14c905b9415930d2febd8d933f3cff60b7f47a69a6e02"],
    ["ChainWhisperDexOperationSettlement","0x1d4f1d06a7978014a1ebc3ab6e0aa9ebe576ac13","0x7fbc4c1e589d6274e602c3aff89f911b1cae73b9546970147f07e87a3da3842a"],
    ["ChainWhisperDexSwapAdmission","0x90e8d9ba5629556b7043645676d1348ef8beca44","0xd80f0095be013bd547c65ff825fb92fdea0cac130cdf40276d837b5f651b9bc1"],
    ["ChainWhisperDexWorkLibrary","0xfba722e7d803322cd4dd1b51a365f30b0e5e94d6","0x6e8b9e719f6ae0352c88edf1de4df8afc669fe4d5259d0f9338c298949d70c54"],
    ["ChainWhisperDexOperationLifecycle","0x9d253b4b44d1a66f53466e3213d6373c977ac825","0x59b92fe7e516e5dcb598a6f3de40fc86839cde6620c7a6861b83676e50855f50"],
    ["ChainWhisperFixedPositionAdmission","0x252f9e52064ecd1f5ca73744602c04362442b1e1","0x6de3549b7a873cb9b130e05257669ffe4153a3b8b1932ce46cd462b33f878d21"],
    ["ChainWhisperSharedPoolClaims","0x5404533f962ef80af7c74c89d35f3333a5f907a3","0x7e756b74ed3b69696afe89c950ef0614ffd831ab6c4f511517680350be46320b"],
    ["ChainWhisperDexPositionCommands","0x0efde36109627035a8b1832b8d1ab7a8d7f9c982","0x73240e814a3e7be4910c58481dc18aca35980e522da5fef4599fd1642541da60"],
    ["ChainWhisperFixedMatchWork","0xfc440da7c7f89724d0bb115ea49db602289d59e5","0x5ef54f1d8cd81213ec8539a2ce1b44dc9bbc5393dbf1ae708ba8e42508a2249e"],
    ["ChainWhisperSharedPoolMathDeployer","0x106f694976dfbaba609f40cfebb478db8059ab43","0x975eade10be93e8e9c865f99412a4eae5168febaee85a34dd610d3825a834bb9"],
    ["ChainWhisperPoolTermsDeployer","0x32ce05a872417718a3cf448f54ada2b8ed98f3d6","0x4c992232ecc4c7db1ce3eee8c32eea634172d49c761474d4162e57747bd52965"],
    ["ChainWhisperRangeAllocationWork","0x850741f6c82075e82ae50990cb2782ea74709c03","0xf50b348c9de660933239f83f4a9b930630671dc556a83043c5a7820cf39a4d98"],
    ["ChainWhisperCreationChunk","0x06106277336a012cfd3502773c3d24f64cfa5d17","0xe4261a738d47e43fcd3b77be1135ea52d08c398497b38808916deba8ab33b1cb"],
    ["ChainWhisperCreationChunk","0x54d9db10da7c7ccc87ad671f2a6124173ac37a4f","0xb2337e02734f34d22b7ff0c14e361b0d0f4774506a21ec8250d91f8b19ea851a"],
    ["ChainWhisperFixedEngineFactory","0xb6c04ea2f94f647621c4eb3248cc566b2fc5b803","0x379aadcb3cd880af13907238954217ccd2f1939682ddb6d30ddc0c8fec7c4b31"],
    ["ChainWhisperDexCore","0x683a0f8482507bf21fd7ac098df769f2d80e00fa","0x62284e69fc64bca219bcfded21739855750b057c58c9f6dd00d1525b2b0450e5"],
  ] as const).map(row => Object.freeze(row))),
  companions: Object.freeze(([
    ["ChainWhisperFixedEngine","0xdfa114b3cae054778679054b17789f7e45d0874b","0xae97bb535943e195c85d9f34f068ba917ac6c75a86606413c2658d52f32c9fea"],
    ["ChainWhisperDexWideTerminalGT","0xe6a4dda10e5b020975c06e11c27907f525d26370","0xd08d39be407fa9701814587265b71103ef02b1ee6ccc5e8805530133c4f4b213"],
    ["ChainWhisperDexFastPoolQuote","0xd24c9e15755c730205858a503933461de377abb7","0x2678dbdb72d5088bee620ee734548675e429e32ec78b187cba1804f0d4f137a4"],
    ["ChainWhisperDexPositionNFT","0xafd8e941cc841a327158cb98b2d702cf735319f6","0xb0cee8c1d31d533eaea965922807b0cfda5c1456ca3aea4cea7691ea5d376217"],
  ] as const).map(row => Object.freeze(row))),
  evaluatorBinding: '0xf74402bf0abb4ec7062ec9812e0b5e7baf48b28017b30b2fa5ae6c277d7fc4d6',
  poolTerms: '0x918749b18152d0a744f413ee0950cddf5ddfc17b',
  factoryStorage: Object.freeze(([
    ["5","0x00000000000000000000000006106277336a012cfd3502773c3d24f64cfa5d17"],
    ["6","0x00000000000000000000000054d9db10da7c7ccc87ad671f2a6124173ac37a4f"],
    ["7","0x00000000000000000000000000000000000000000000000000000000000086a4"],
    ["10","0x000000000000000000000000683a0f8482507bf21fd7ac098df769f2d80e00fa"],
  ] as const).map(row => Object.freeze(row)))
});
export const STAGED_TWO_POOL_CANDIDATE: CurrentCheapDexCandidate = Object.freeze({
  ...ARCHIVED_CHEAP_DEX_CANDIDATE,
  graph: "bc060b7c78de8a9a7c8a80ee1a5fa19b595581ac2f7bb170f8f166885fcbec66",
  packageSha256: "2756c36ebefcfefc170a0fc342dbc0b09e5754f97adcfe694b2bf3452001ccb0",
  core: "0xc315ce0f704830e0f6ecc4f81bf8260a865bb7e7",
  attestationSha256: "db80e731a0bf85a5bb968da4fa38d70742f5fc0f71c1b6a58d400d47f08e4e8d",
  attestationBlock: Object.freeze({"number":"9889561","hash":"0x6b19f4cc54c14984b1887442d127247a266b5fd51ff0da3dbc72d0b7d5d82d78"}),
  runtimes: Object.freeze(([
  [
    "ChainWhisperRangeWork",
    "0xb458bee9065df4142760509cb82cc14d27dc2e90",
    "0x7d41769c9bee160313f1796843a94e80969a8eb3ea05c051aa914683c2594c7f"
  ],
  [
    "ChainWhisperOrderWork",
    "0xaa1417b6f60ce06633e9f37445b0417e792ff244",
    "0xb129c83a6cb951ef4950bf8d229827a7d87011f06b9e70ae3f5dd1c2e33e868d"
  ],
  [
    "ChainWhisperRecurringOwnerControls",
    "0x1d1f279e33e3ac214dda0a1d88360e2b95bae902",
    "0xd00c62d60ea9ac6b50aea735a3ef2822ae27d91d1d9444516dd95979d2e8ae52"
  ],
  [
    "ChainWhisperFixedOwner",
    "0xd9dea5c61efd3fbc34a8f28766ccb7c08ffc0301",
    "0xfeeca2f3ac8cca8d27ae946bf2a0101bc78e32943e9b2557fe7ec47f4d868701"
  ],
  [
    "ChainWhisperOrderOwnerLifecycle",
    "0x271ebb53face47bb84d143d531c3b2fd43e1a283",
    "0xbc2961f333102041ffa54eff97e6e7d7868ff1e23698b858d7a41820d9073faf"
  ],
  [
    "ChainWhisperRangeOwner",
    "0x8d19704b55d9a77ce791bcbc3a41116773684079",
    "0xb7096b82e25640c8425afabea3e666792cadd8d65e86c4c446e090a3b2f29224"
  ],
  [
    "ChainWhisperFixedWorkLifecycle",
    "0x6a301d342f14482414a9a4a7f93ac8d27d996021",
    "0x5bba1f01137e806ed9ebf9f28e99872c2a6458c0b924b7704e3c98fd44c4aae2"
  ],
  [
    "ChainWhisperFixedProtectedRatio",
    "0x7934d1d9f480c1f6c562e7bc6dc8ee229ad43d95",
    "0xc9c92f2de2787403ad4d3a7d5316cad82e625c6fc954c002189db807b20e481f"
  ],
  [
    "ChainWhisperFixedSelectorMath",
    "0xa271d191139f0e0281581c65c9fdad4c0cc7970e",
    "0x1cbb538474a0e516a638e67a565bd7c9d86da02a7be29f068b69d1e118c4e9ac"
  ],
  [
    "ChainWhisperFixedBoundedSelector",
    "0x9aa1460aedd52ce7840486e3e01cf766a65fec1a",
    "0x86c122a43c312932ae829d02e07936672b6c1c14312351a81556c31800a3955a"
  ],
  [
    "ChainWhisperConcentratedQ96Module",
    "0xdcfd6bfe71cf1ffccfa2da744f45ac1a2bafbadc",
    "0x9e5905c0f97ab87d6ee90dc20d01e3c5e34405fc00c52157f0aa258b23f6ed5b"
  ],
  [
    "ChainWhisperSinglePassAllocationGT",
    "0xfdf3afeb5d14acfd3e1d6dfdcae28e4352767649",
    "0xb7328fba00f141113fef5d44157e92dda87602b5cea42e48e6a17c4df54d08f1"
  ],
  [
    "ChainWhisperConcentratedPoolQuoteModule",
    "0x3138d7c15ec2b0df794b668c43cbbcd440f646be",
    "0x96897d592bfafaae08ab4912a9ff7c247c73759246dc5909bc5e09a60f36c512"
  ],
  [
    "ChainWhisperDexReceiptAccess",
    "0x63126df3dff8280d5b140eb84d7a2da5fb72b82f",
    "0x1314662c5f8b386a5f7f9049e3ddb327ab3d116236e6c718c508ddfd58b83099"
  ],
  [
    "ChainWhisperDexCheapAsyncQuote",
    "0x6af3af1bc3c1d07c6ed6148fc1e3f48af04ee8f7",
    "0xce6a60a290a67277670311f443cf52024519f1f8fac65f4e3ff2b801797e07d1"
  ],
  [
    "ChainWhisperPoolOwner",
    "0xc01bc4790bc84ef9373f744960800d250f02539c",
    "0xc450b1eec8290633d30b5fc1f0172e82d2790bde74942d805f9691bc951b03c6"
  ],
  [
    "ChainWhisperDexCheapAsyncTerminal",
    "0x0267dcf56ac2b9609d367075c97019eb333484ad",
    "0xfd67037ac542875998b113f3c63b41c37c216c3cde5a55e896ca657f49463659"
  ],
  [
    "ChainWhisperDexCheapAsyncRouter",
    "0x00efaf3277caaa6325e89dcb0d346cfa5db6cb5e",
    "0xa77054eda3be7e54490796670820de586a1537f73e215801d08069d2c78b852d"
  ],
  [
    "ChainWhisperDexFastPoolLifecycle",
    "0x3b6738eb2dbf4356dd6f411dfd591d8d9b60da3a",
    "0xe6c1121de53d774df06de54188370b883b23db6f370994a4a94d2d3cda98f3cc"
  ],
  [
    "ChainWhisperDexFastPoolSettlement",
    "0x1a04a7bbec48e5b514deaf635f560da4b9ae5d73",
    "0x94c73be00c2e772a7a1f135b0d211c9a4f7b365a9de021982156374503b7974e"
  ],
  [
    "ChainWhisperDexPoolWorkLibrary",
    "0x93a3c90c71c7d1f5eae8173b822a825883f11174",
    "0x69a8118b2d6bb672ce24996c87e9d589e3b0c43b2fbae8568d83e2439cb4372a"
  ],
  [
    "ChainWhisperDexJointWorkLibrary",
    "0x61dc7aca560e886a6e1eaca0a5d3c152f69c3b01",
    "0xc0f54d3cff3d7ce7c7a688d882871201033ad097edf6443a4e488f5da618da0c"
  ],
  [
    "ChainWhisperDexJointSettlement",
    "0x5f319e64a6655bc174f0608e46def4b29c719a76",
    "0xe6464330f2db1abb3ba559fabaa513c8a4861964213ce893028b1f27507ceaf0"
  ],
  [
    "ChainWhisperDexLimitMatchSettlement",
    "0xe5e2c8502cdf18d6f591afdd83e8cdf0e2d52844",
    "0x7dd29e1a3985b88ac387aff924a6dca6c4c4d7b59a90d8dee1900ea3ce7b604a"
  ],
  [
    "ChainWhisperDexOperationRelease",
    "0x9a62475905a0e3aaa0b350df0141aaf4f9b2994f",
    "0x673dda2de45811a72a615c848506c772d966ee17316fa146189597c1e278cbcc"
  ],
  [
    "ChainWhisperDexOperationSettlement",
    "0xbb3cefa6c091a8e459511548c769c77bdb2a591b",
    "0x2e2e2fba0996b6bd06c100b79bf2996c19188ca8a13cdd53f464476c240c247f"
  ],
  [
    "ChainWhisperDexSwapAdmission",
    "0x36ee2d5bc05c347230a8ebbdcab2b6ce02428555",
    "0x3dcb8eb10ceda6f375fb0d323955a9e2e8ebf6f76b25aada4c67c69c526f3613"
  ],
  [
    "ChainWhisperDexWorkLibrary",
    "0xdbc387fec0a151781a5bfea2700c758b2ed32ebd",
    "0x7e87ea749fa5933bb6f8e0de34e1805b7f75339a4dfe4a68bb7c74e381d53e25"
  ],
  [
    "ChainWhisperDexOperationLifecycle",
    "0x8ec0eee1ddc85eb45ebf026f7725f6d8401d31ef",
    "0x78502d2d5625edca277c38442bf38da3c740ba7ec157c27f3ca5d7709d47f717"
  ],
  [
    "ChainWhisperFixedPositionAdmission",
    "0xd4825597819d772e81c3dd7fe17685e33271dd2e",
    "0x3cd1279ebdceb8c9a63d3dd4d424b1f41e479aa05017bc4235ceb41943c62b91"
  ],
  [
    "ChainWhisperSharedPoolClaims",
    "0x09bd3092cd2aa610d287634917a8ab570a31645d",
    "0xfeaf9c9917395c54301182700bcf0cc11cab915a7499f450d4642ac151114d15"
  ],
  [
    "ChainWhisperDexPositionCommands",
    "0x838e5f084d602d9288eb495e0ddb2d97847cce65",
    "0x20b408f4964d2648948bbb5b60ef2ce3640e3fd1ccbefc8a211b9a28f8b2fd48"
  ],
  [
    "ChainWhisperFixedMatchWork",
    "0xbdbae318e5c9e4b5694fec62222d3ff4163d7ca5",
    "0xbec6d5fc391799c36667c8955073f331499cfb4941b275161c5241ab8aed7652"
  ],
  [
    "ChainWhisperSharedPoolMathDeployer",
    "0xc6459be6a656682cd4bde8a27f75cd66340cf2b6",
    "0x1df60ce77a272e5144b5c91ad18ba2a21cba633a634e044cf27cb5cc67e2488f"
  ],
  [
    "ChainWhisperPoolTermsDeployer",
    "0x541be93d4132054e2379b21682d0e054ebe73da5",
    "0x8fea691ca5a09e06b02baed287e455d71cb473e3f0e1f26ef0c1e3525504b609"
  ],
  [
    "ChainWhisperRangeAllocationWork",
    "0xfb967aba16ea9a8515572cd695e4537a387b4fd9",
    "0x658ad1e0424c5c5d4c617b8019e7cdd5a92825f62192863d69814f6fc9977c30"
  ],
  [
    "ChainWhisperCreationChunk",
    "0x10b85842487520d99f065c17a77033ab86597809",
    "0x63fd84775e40be9556379133c171a05ea5e05356faff122cbd3401875e5127a6"
  ],
  [
    "ChainWhisperCreationChunk",
    "0xc6be883daef1c9017ec72bdb7a7c176b464b798d",
    "0x2abccf7d25934a3b2660443573559c8cc51f52f1e7c169d577743a1a32464ad3"
  ],
  [
    "ChainWhisperFixedEngineFactory",
    "0xa0edb64ad917cd2174624d59c42f6b4b0537b1c6",
    "0x970cd5b282756147e9e253c4d3f7de4be015abdede191042fc6d96c3ff40b607"
  ],
  [
    "ChainWhisperDexCore",
    "0xc315ce0f704830e0f6ecc4f81bf8260a865bb7e7",
    "0x760158a0c8ba0be50084216e520d3515e6ce2b29bf5ad7cfb2c971ef4d96d4c9"
  ]
] as const).map(row => Object.freeze(row))),
  companions: Object.freeze(([
  [
    "ChainWhisperFixedEngine",
    "0xe69b42b0260583ac897478ee650e535a271d9582",
    "0x6200fbcebb557520304b750927c6df0c248d8dca7fb2a8d263c2724e190ba383"
  ],
  [
    "ChainWhisperDexPositionNFT",
    "0x62b10e12ac3b9344c446e2b6262e4a0c6623b9be",
    "0xa3c4755935f2a872761eecda74fc1aff644cd0f969ddeafc099a771b0a134e57"
  ],
  [
    "ChainWhisperDexWideTerminalGT",
    "0xc0c4a6c98c4b4b0be4eb4a1d27c429be5f7a2813",
    "0xaf6cdb3757856646c1d1200d051ee6c65de44d150941c06fb84528ae0b972f1e"
  ],
  [
    "ChainWhisperDexFastPoolQuote",
    "0xe47359668c09ce8c2659103cc41abfa4f2ef0515",
    "0xa5104822fe294c0fd0f441faf76e516388060b3b5353780abfd3dd072ae05015"
  ]
] as const).map(row => Object.freeze(row))),
  evaluatorBinding: "0xec048e3f1271afc2cc7cb9f4ddca50ff1062226fbfb425b5a80876fa3a35311d",
  poolTerms: "0x1b505979a9fe7dd9bede67b763965b8c57e445c1",
  factoryStorage: Object.freeze(([
  [
    "5",
    "0x00000000000000000000000010b85842487520d99f065c17a77033ab86597809"
  ],
  [
    "6",
    "0x000000000000000000000000c6be883daef1c9017ec72bdb7a7c176b464b798d"
  ],
  [
    "7",
    "0x00000000000000000000000000000000000000000000000000000000000086a3"
  ],
  [
    "10",
    "0x000000000000000000000000c315ce0f704830e0f6ecc4f81bf8260a865bb7e7"
  ]
] as const).map(row => Object.freeze(row))),
});

export const STAGED_POOL_REFERENCE_CANDIDATE: CurrentCheapDexCandidate = Object.freeze({
  ...ARCHIVED_CHEAP_DEX_CANDIDATE,
  graph: "6d636a45f6c24a08b78a15070241b4ccfa0b63822fdac2ca3a40dd4a5533788e",
  packageSha256: "8b80b22eb40474f92b864c9cce966f2bca1c0485e65570943ed5a7ffac9def21",
  core: "0xe35f5da20d4d3a2bba74d24b455c0a1b789ca66e",
  attestationSha256: "f0eb6bfd0b4fbadb02508301f13290ef4912aaa72b3efa077c272b785281648a",
  attestationBlock: Object.freeze({"number":"9891044","hash":"0xe98be3ca623c69bfbaab7118854b448e9723b6dccdf6bcb70bdde6538fc3178b"}),
  runtimes: Object.freeze(([
  [
    "ChainWhisperRangeWork",
    "0x8e7412d5ef415f9589992793ea9514ac4b4d937e",
    "0xeb47dbe90cb6c02008497f34ae1cb7ae68d5b30c9175c58206c5db448d4b9309"
  ],
  [
    "ChainWhisperOrderWork",
    "0xe9fddc280b83099132d80573650ef44c04d24889",
    "0xae3e0b83c990980d381907b29be5214e0e6faf9c2d51dfdac68fdfd031bf738e"
  ],
  [
    "ChainWhisperRecurringOwnerControls",
    "0x629cd7c094373729e14f65e6313f5ad8554e92e5",
    "0xefc8a90888cd0557160b5fa3b227043616584e1a8c8a310c736a0f708a0ae90a"
  ],
  [
    "ChainWhisperFixedOwner",
    "0xb071b6e0e5bdff03199cd7f6820f8b9928121349",
    "0xc75789d709c0680038ed23276e410666510d54a9ea712492bda4be8ce1ed241e"
  ],
  [
    "ChainWhisperOrderOwnerLifecycle",
    "0x7ebbd6859e94f020e38b76041d25a115893bd9cb",
    "0x6133403c0c603b8d2883e043b0ff087f8c09e7fcd359b40fc94b32839364e546"
  ],
  [
    "ChainWhisperRangeOwner",
    "0xf6084295221fc0a19219d0d8eaaabd16626917fa",
    "0xc7b507fc2e358f04644eb05c104c8e457273d7a0ee28b018dbcb7c2b6de77d98"
  ],
  [
    "ChainWhisperFixedWorkLifecycle",
    "0x014ac38e7a5ab275f0d9c503407c3109320da814",
    "0xea9bcfa6635353ff5b57933cacc75ca35221bfc89b028b0e426f0fed4662abb6"
  ],
  [
    "ChainWhisperFixedProtectedRatio",
    "0x81cef1208e06cc627b8bc8a93078226903f56a3d",
    "0xc9c92f2de2787403ad4d3a7d5316cad82e625c6fc954c002189db807b20e481f"
  ],
  [
    "ChainWhisperFixedSelectorMath",
    "0x5b40b52a5009bbfadf9f7db888b48f893af4129a",
    "0xe6249ccb03292e351fadb27e8de86f927d10a77676fb6986e265fc14f0434a1e"
  ],
  [
    "ChainWhisperFixedBoundedSelector",
    "0x7e6b1fba95d2162038b2f77c508cfacd7437cec0",
    "0xa89e8232011ce8e429b4900dee021a8877e0114065424a6d5c16449f206717e0"
  ],
  [
    "ChainWhisperConcentratedQ96Module",
    "0x053d8782cb96cac27ed1a0fbe1547ea31f0b2a4b",
    "0x5b237037e912e0b88a8f7bf07782d571912f22df89ff0fd20d0e2044aa69b67a"
  ],
  [
    "ChainWhisperSinglePassAllocationGT",
    "0xb00ac327bf4b6c0a9e9a509fc1dd740b3c5b58ff",
    "0x80f3c962daf24577b3975ab1503b0ec1aa79b0307127fa0ed74acfe5e7b3e394"
  ],
  [
    "ChainWhisperConcentratedPoolQuoteModule",
    "0x9efda4dc5df3db0f04d5ad3da2402abce4cf1335",
    "0xce94bd0485ada7fa80ed9a9256d01b134b51941b1f99a6b34a71075b0eb3472a"
  ],
  [
    "ChainWhisperDexReceiptAccess",
    "0x372bf26c14a1bedf5ddbcfaf3a9dc35b144ad12e",
    "0xf22429abc49f2fa5fe3341606ff5b5d37ce560539064dbdc69e1cc5b897cfe05"
  ],
  [
    "ChainWhisperDexCheapAsyncQuote",
    "0xdc7a55f2db6188237cd7fc1fb29d7767c6f913e9",
    "0xd996af9888377ec885d98071de1d90224be128182c1eff9d6b628c40fcf9562f"
  ],
  [
    "ChainWhisperPoolOwner",
    "0x63cd331e6a0a7dcba5a7d6e80802f570a1e95588",
    "0xccec6bedf8127296e1a36283f7505505514a1217cac1df76d35979a617782ba4"
  ],
  [
    "ChainWhisperDexCheapAsyncTerminal",
    "0x9152df544c914d46f854943d76e8e5a34babdcbd",
    "0x750d5d303d34f5e227e0c747c659440f90b84b453433199d519a779c4914564a"
  ],
  [
    "ChainWhisperDexCheapAsyncRouter",
    "0xbdd3626f892c2d01e0d96cbe05695d7278002f86",
    "0x91546ce5e0f0b710d9fc9a6b004241a255b38474682ec140cb2fb460512ea30a"
  ],
  [
    "ChainWhisperDexFastPoolLifecycle",
    "0x27602383d6c0527d4c0c6f43a2d0ac7a487a5f7b",
    "0x9a97fc42c9fc62b144c83302bce2f8a13b99c4628c46f83cb605e4cc2d20f584"
  ],
  [
    "ChainWhisperDexFastPoolSettlement",
    "0x7ac64154221742a7e8be4f2b2f86eff1def59025",
    "0x70c2ecc178245df2ee684a48bc07a95c23d769858a00ca08c17edf70ba8ac238"
  ],
  [
    "ChainWhisperDexPoolWorkLibrary",
    "0x689b65e4d435303eac6c3db6454726596dbe197a",
    "0xa99d67b92ff28ed97b3f5ec352c5549dadc356923c22a7b0b5bebb3de91b1d88"
  ],
  [
    "ChainWhisperDexJointWorkLibrary",
    "0x9641911464fbc23854bb04a9249213991e604dbf",
    "0x1d783cded5e422b0c377cb36f9ff1b63fadeee72f1896cc36fec738757c03ad5"
  ],
  [
    "ChainWhisperDexJointSettlement",
    "0x0d64c6505cc1989239f722abf8904f61f55dd82f",
    "0xd8ba21199008e4bee447111d961d5eacf60ee8f43e72de544667ac1de2bdc15d"
  ],
  [
    "ChainWhisperDexLimitMatchSettlement",
    "0xab9da2f716f2eb0f8ccbf9a1927b645b408e72c3",
    "0x19e6e9af5adce5280cb1ba972807356a4a8bb556aaa99b5039797e09df0e57bd"
  ],
  [
    "ChainWhisperDexOperationRelease",
    "0xc6dbec70275da915d63f3ecfb2b8fa63f00f9bda",
    "0x14693e28635bfb33cf5f52fd43a26c3faecec91e2318bd675fb326f50bd6496d"
  ],
  [
    "ChainWhisperDexOperationSettlement",
    "0x2f392705aae3e1e3681bfbb1d7306fcdc0eabf02",
    "0x4f268537a92f5532e82376e4597934234747de8af647c8ea09945d5a3cf2e905"
  ],
  [
    "ChainWhisperDexSwapAdmission",
    "0x50f1a0e7331f4554ea941f27dd15aa6b359a0e6f",
    "0x338dd8862c00dad048514340d5905880dc6dd7b467b5c547b3ad63dac1aba529"
  ],
  [
    "ChainWhisperDexWorkLibrary",
    "0xd3836b7ac48d8a16fe3870ba846eca47e70aa78c",
    "0xda7d318b8c8293a66c0751e2801c33cd24e68326d98a0eefcd1be5352a4ad58b"
  ],
  [
    "ChainWhisperDexOperationLifecycle",
    "0x822abde0a6dd186154afcd4f53a8a15315015951",
    "0x838b109daa56ace92955a621167b4fe5e8bf0c056d4f0090f84e22b0bfcd1ce9"
  ],
  [
    "ChainWhisperDexPoolReference",
    "0x90a6e3e62f49aeafaca650aca6f0b94bdf898d45",
    "0x9f136a93c6d92406c3b7497039b7006780aa735f00169529e1095b0d610d921f"
  ],
  [
    "ChainWhisperFixedPositionAdmission",
    "0x55e832081f5dd112509074b328212c1c28683fea",
    "0x8bd513ba4de45603a37f77de7dabbe45df9d4fbd34842999bde07a362fc0d77c"
  ],
  [
    "ChainWhisperSharedPoolClaims",
    "0xeab0656234b4a636b1b8f9ee65a51c5be12c44c7",
    "0xae78fcbddf122de6b554389122a0f4f9f98bf5994cc1a84933065333ed0afdb0"
  ],
  [
    "ChainWhisperDexPositionCommands",
    "0xbdc3aea2e6ad58db43aebb20b78def6017d6842a",
    "0x7c24b63820a78490172b541cf68351d438f48a1d3bc8780a18d1a6add9033585"
  ],
  [
    "ChainWhisperFixedMatchWork",
    "0xc6b50d3c0ca50605980077a2ae8f85e3b3f9b819",
    "0xc4da8480148fcc8750f601c0ee82b8dbf0e870a2f0ba05bb58feef6a78fde2ee"
  ],
  [
    "ChainWhisperSharedPoolMathDeployer",
    "0x5a49e3675f82a15c7e662620a2223a2f3cec1028",
    "0x501a53176959cd55ebb397f91b3497042476eea8f74a03018aa2fb2dfdbc4d64"
  ],
  [
    "ChainWhisperPoolTermsDeployer",
    "0xf2669fa4f20f8d12aacea652adc9afd65d184713",
    "0xc50cca5e596a8d9bdbf5d805826aeaa291a4cf2908cacb4b819d2d5bb8f509d3"
  ],
  [
    "ChainWhisperRangeAllocationWork",
    "0xabe8aa5a2cd330d8fbb9f2fdb90443cb092af95d",
    "0xa993a962c94403f623d0069cd19a660ff19513a79bcc845e3c4d4dca4859f558"
  ],
  [
    "ChainWhisperCreationChunk",
    "0x869df95f1de7b5d6432e7af03070631b2129eb8a",
    "0x77c25c8e87c777650e62897caf71e2c908661eb257df566cd520d6c21d1eb284"
  ],
  [
    "ChainWhisperCreationChunk",
    "0x104370b99d723578fce7e7d50bcd40bfa93c2adb",
    "0xd79e9acbad140c4235e43997c7b08fe20a6c536c9c7f31ceca50ea3e0a7d090d"
  ],
  [
    "ChainWhisperFixedEngineFactory",
    "0x64b84676d18e70ffe968142bbeea41e8187caae6",
    "0x970cd5b282756147e9e253c4d3f7de4be015abdede191042fc6d96c3ff40b607"
  ],
  [
    "ChainWhisperDexCore",
    "0xe35f5da20d4d3a2bba74d24b455c0a1b789ca66e",
    "0x6bc1841652e1ba83c9f95ba52dda7f4b96ce89c308e9e4047f7362811fecf187"
  ]
] as const).map(row => Object.freeze(row))),
  companions: Object.freeze(([
  [
    "ChainWhisperFixedEngine",
    "0xe4c50dcd11fdc4eda25757291315b8e06385a490",
    "0x811a1623e61721f9f336f0645c3fac6d811a9b54e1d27a0770280ab960e49178"
  ],
  [
    "ChainWhisperDexWideTerminalGT",
    "0xb17885939f511a41f80ab3a6eaf61154abc176be",
    "0x5dc05a4e0d14d995bdb3658038f9fee0279510d0d3bd0badd58e46d163d3f5e2"
  ],
  [
    "ChainWhisperDexFastPoolQuote",
    "0xe6cde0b57054f1bec0bd94d2b744a7c1389f4dc2",
    "0x8d46a103d11a3f5fa8b342089cc5259bf1876191cbc74ab837e58a393e832db0"
  ],
  [
    "ChainWhisperDexPositionNFT",
    "0x9af9b980be3c6b4ee16c52b7733c699f3c43abe3",
    "0x2e07373bd3092181caf9f720de36b481ad39a3e08782cb040770abae33371ab8"
  ]
] as const).map(row => Object.freeze(row))),
  evaluatorBinding: "0x28cfd7e2a3429fefe330023f10a89f2dda76369a8caf7f568b2864549319b5eb",
  poolTerms: "0x8d06a96be7b3260ad2cd23db9ca634c7f9c24340",
  factoryStorage: Object.freeze(([
  [
    "5",
    "0x000000000000000000000000869df95f1de7b5d6432e7af03070631b2129eb8a"
  ],
  [
    "6",
    "0x000000000000000000000000104370b99d723578fce7e7d50bcd40bfa93c2adb"
  ],
  [
    "7",
    "0x00000000000000000000000000000000000000000000000000000000000086a3"
  ],
  [
    "10",
    "0x000000000000000000000000e35f5da20d4d3a2bba74d24b455c0a1b789ca66e"
  ]
] as const).map(row => Object.freeze(row))),
});

export const CURRENT_CHEAP_DEX_CANDIDATE: CurrentCheapDexCandidate = STAGED_D06_DEX_CANDIDATE;
export type CurrentCheapDexIdentity = Readonly<{ graph: string; packageSha256: string; core: string }>;
export type CurrentCheapDexCandidateKey = 'cheap-current' | 'cheap-archived' | 'cheap-slippage' | 'cheap-two-pool' | 'cheap-reference' | 'cheap-native' | 'cheap-d06' | 'cheap-prepared' | 'cheap-exit' | 'cheap-history';
export const resolveCurrentCheapDexCandidate = (key: CurrentCheapDexCandidateKey): CurrentCheapDexCandidate => {
  switch (key) {
    case 'cheap-current': return CURRENT_CHEAP_DEX_CANDIDATE;
    case 'cheap-archived': return ARCHIVED_CHEAP_DEX_CANDIDATE;
    case 'cheap-slippage': return STAGED_QUOTE_SLIPPAGE_CANDIDATE;
    case 'cheap-two-pool': return STAGED_TWO_POOL_CANDIDATE;
    case 'cheap-reference': return STAGED_POOL_REFERENCE_CANDIDATE;
    case 'cheap-native': return STAGED_NATIVE_DEX_CANDIDATE;
    case 'cheap-d06': return STAGED_D06_DEX_CANDIDATE;
    case 'cheap-prepared': return STAGED_PREPARED_DEX_CANDIDATE;
    case 'cheap-exit': return STAGED_EXIT_PREVIEW_DEX_CANDIDATE;
    case 'cheap-history': return STAGED_SHARED_HISTORY_DEX_CANDIDATE;
    default: throw new Error('Unknown current DEX candidate.');
  }
};
export const currentCheapDexCandidateKey = (identity: CurrentCheapDexIdentity): CurrentCheapDexCandidateKey => {
  // Resolve protocol from the canonical identities. The active alias is not a protocol version.
  for (const key of ['cheap-archived', 'cheap-slippage', 'cheap-two-pool', 'cheap-reference', 'cheap-native', 'cheap-d06', 'cheap-prepared', 'cheap-exit', 'cheap-history'] as const) {
    const c = resolveCurrentCheapDexCandidate(key);
    if (identity.graph === c.graph && identity.packageSha256 === c.packageSha256 && identity.core.toLowerCase() === c.core) return key;
  }
  throw new Error('Current DEX graph, package and Core do not match a reviewed candidate.');
};
export const currentCheapDexStages = (identity: CurrentCheapDexIdentity = CURRENT_CHEAP_DEX_CANDIDATE): Readonly<{
  workCalls: number; ready: number; funded: number; settled: number; released: number
}> => {
  const key = currentCheapDexCandidateKey(identity);
  if (key === 'cheap-prepared') return STAGED_PREPARED_DEX_CANDIDATE.protocol.stages;
  if (key === 'cheap-exit') return STAGED_EXIT_PREVIEW_DEX_CANDIDATE.protocol.stages;
  if (key === 'cheap-history') return STAGED_SHARED_HISTORY_DEX_CANDIDATE.protocol.stages;
  const successor = key === 'cheap-two-pool' || key === 'cheap-reference' || key === 'cheap-native' || key === 'cheap-d06';
  return Object.freeze(successor ? { workCalls: 4, ready: 5, funded: 6, settled: 7, released: 8 }
    : { workCalls: 3, ready: 4, funded: 5, settled: 6, released: 7 });
};
export const currentCheapDexQuoteProtocol = (candidate: CurrentCheapDexIdentity) =>
  currentCheapDexCandidateKey(candidate) === 'cheap-prepared' ? STAGED_PREPARED_DEX_CANDIDATE.protocol.name :
    currentCheapDexCandidateKey(candidate) === 'cheap-exit' ? STAGED_EXIT_PREVIEW_DEX_CANDIDATE.protocol.name :
    currentCheapDexCandidateKey(candidate) === 'cheap-history' ? STAGED_SHARED_HISTORY_DEX_CANDIDATE.protocol.name :
    ['cheap-slippage', 'cheap-two-pool', 'cheap-reference', 'cheap-native', 'cheap-d06'].includes(currentCheapDexCandidateKey(candidate)) ? 'quote-slippage' as const : undefined;
export const currentCheapDexOwnerActionEligible = (candidate: CurrentCheapDexIdentity | undefined, stage: number | undefined, action: 'cancel' | 'recover') => {
  const stages = currentCheapDexStages(candidate);
  return action === 'cancel' ? Number.isInteger(stage) && stage! >= 1 && stage! <= stages.ready : stage === stages.funded;
};
// Successor construction, empty matching or refresh receipts are not App phase admission.
export const assertCurrentCheapDexNativeAdmission = (candidate: CurrentCheapDexIdentity): void => {
  if (currentCheapDexStages(candidate).workCalls === 4) throw new Error('Successor DEX native App submission admission is absent.');
  if (candidate.graph !== CURRENT_CHEAP_DEX_CANDIDATE.graph || candidate.packageSha256 !== CURRENT_CHEAP_DEX_CANDIDATE.packageSha256 ||
      candidate.core.toLowerCase() !== CURRENT_CHEAP_DEX_CANDIDATE.core) {
    throw new Error('Staged DEX native App submission admission is absent.');
  }
};

export type DexV2ComponentKey = typeof DEX_V2_COMPONENT_KEYS[number];

export type DexV2AppManifest = Readonly<{
  schemaVersion: 1;
  status: 'activated-testnet';
  network: 'cotiTestnet';
  chainId: typeof COTI_TESTNET_CHAIN_ID;
  productionActivationEvidence: false;
  operator: string;
  owner: string;
  deploymentPlanHash: string;
  deploymentCandidateHash: string;
  activationPlanHash: string;
  activationReportHash: string;
  addresses: Readonly<Record<DexV2ComponentKey, string>>;
  runtimeHashes: Readonly<Record<DexV2ComponentKey, string>>;
  deploymentAnchors: Readonly<{
    factory: Readonly<{ number: string; hash: string }>;
    economicSuite: Readonly<{ number: string; hash: string }>;
    pairRegistration: Readonly<{ number: string; hash: string }>;
  }>;
  pair: Readonly<{
    pairKey: string;
    baseToken: string;
    quoteToken: string;
    baseTokenRuntimeHash: string;
    quoteTokenRuntimeHash: string;
    privateTokenRuntimeManifestHash: string;
    privateTokenRuntimeManifestLength: number;
    baseDecimals: number;
    quoteDecimals: number;
    baseLotSize: string;
    quoteLotSize: string;
    maximumAggregateLots: string;
    tickTableHash: string;
  }>;
  activation: Readonly<{
    result: 'pass';
    transactionCount: 16;
    measuredRouteCount: 4;
    finalBlock: Readonly<{ number: string; hash: string }>;
    allProofsPassed: true;
    routeGasP95Passed: true;
    routeGasMaximumPassed: true;
    routeLatencyP95Passed: true;
  }>;
  manifestHash: string;
}>;

export type DexV2DeploymentConfig =
  | Readonly<{ status: 'inactive' }>
  | Readonly<{ status: 'invalid'; error: string }>
  | Readonly<{
      status: 'active';
      manifest: DexV2AppManifest;
      finalityLagBlocks: bigint;
      rpcUrl: string;
      fingerprint: string;
    }>;

const MANIFESTS = new WeakSet<object>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, expected: readonly string[], label: string): void => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields are invalid.`);
  }
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
};

export const hashDexV2AppManifestBody = (body: unknown): string =>
  keccak256(toUtf8Bytes(JSON.stringify(canonicalize(body)))).toLowerCase();

const required = (env: Readonly<Record<string, unknown>>, key: string): string => {
  const value = env[key];
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`DEX V2 requires ${key}.`);
  }
  return value;
};

const decimal = (value: unknown, label: string, maximum = UINT64_MAX, allowZero = false): string => {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new Error(`${label} must be canonical decimal.`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum || (!allowZero && parsed === 0n)) {
    throw new Error(`${label} is out of range.`);
  }
  return value;
};

const integer = (value: unknown, label: string, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error(`${label} is out of range.`);
  }
  return Number(value);
};

const address = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error(`${label} is invalid.`);
  let normalized: string;
  try {
    normalized = getAddress(value).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const hash = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !BYTES32.test(value) || value.toLowerCase() === ZERO_BYTES32) {
    throw new Error(`${label} must be non-zero bytes32.`);
  }
  return value.toLowerCase();
};

const booleanLiteral = <T extends boolean>(value: unknown, expected: T, label: string): T => {
  if (value !== expected) throw new Error(`${label} must be exactly ${String(expected)}.`);
  return expected;
};

const parseBlock = (value: unknown, label: string) => {
  if (!isRecord(value)) throw new Error(`${label} is invalid.`);
  exactKeys(value, ['number', 'hash'], label);
  return Object.freeze({
    number: decimal(value.number, `${label} number`),
    hash: hash(value.hash, `${label} hash`)
  });
};

const parseComponents = <T extends 'address' | 'hash'>(
  value: unknown,
  kind: T
): Readonly<Record<DexV2ComponentKey, string>> => {
  if (!isRecord(value)) throw new Error(`DEX V2 component ${kind}s are invalid.`);
  exactKeys(value, DEX_V2_COMPONENT_KEYS, `DEX V2 component ${kind}s`);
  const entries = DEX_V2_COMPONENT_KEYS.map((key) => [
    key,
    kind === 'address'
      ? address(value[key], `DEX V2 ${key} address`)
      : hash(value[key], `DEX V2 ${key} runtime hash`)
  ] as const);
  if (kind === 'address' && new Set(entries.map(([, item]) => item)).size !== entries.length) {
    throw new Error('DEX V2 component addresses must be distinct.');
  }
  return Object.freeze(Object.fromEntries(entries)) as Readonly<Record<DexV2ComponentKey, string>>;
};

export const parseDexV2AppManifest = (text: string): DexV2AppManifest => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('DEX V2 manifest must be valid JSON.');
  }
  if (!isRecord(parsed)) throw new Error('DEX V2 manifest must be an object.');
  exactKeys(parsed, [
    'schemaVersion',
    'status',
    'network',
    'chainId',
    'productionActivationEvidence',
    'operator',
    'owner',
    'deploymentPlanHash',
    'deploymentCandidateHash',
    'activationPlanHash',
    'activationReportHash',
    'addresses',
    'runtimeHashes',
    'deploymentAnchors',
    'pair',
    'activation',
    'manifestHash'
  ], 'DEX V2 manifest');
  if (
    parsed.schemaVersion !== 1 ||
    parsed.status !== 'activated-testnet' ||
    parsed.network !== 'cotiTestnet' ||
    parsed.chainId !== COTI_TESTNET_CHAIN_ID
  ) {
    throw new Error('DEX V2 manifest identity is invalid.');
  }
  booleanLiteral(parsed.productionActivationEvidence, false, 'DEX V2 production activation evidence');
  const addresses = parseComponents(parsed.addresses, 'address');
  const runtimeHashes = parseComponents(parsed.runtimeHashes, 'hash');

  if (!isRecord(parsed.deploymentAnchors)) throw new Error('DEX V2 deployment anchors are invalid.');
  exactKeys(parsed.deploymentAnchors, ['factory', 'economicSuite', 'pairRegistration'], 'DEX V2 deployment anchors');
  const deploymentAnchors = Object.freeze({
    factory: parseBlock(parsed.deploymentAnchors.factory, 'DEX V2 factory deployment anchor'),
    economicSuite: parseBlock(parsed.deploymentAnchors.economicSuite, 'DEX V2 economic deployment anchor'),
    pairRegistration: parseBlock(parsed.deploymentAnchors.pairRegistration, 'DEX V2 pair-registration anchor')
  });
  if (
    BigInt(deploymentAnchors.factory.number) > BigInt(deploymentAnchors.economicSuite.number) ||
    BigInt(deploymentAnchors.economicSuite.number) > BigInt(deploymentAnchors.pairRegistration.number)
  ) {
    throw new Error('DEX V2 deployment anchors are out of order.');
  }

  if (!isRecord(parsed.pair)) throw new Error('DEX V2 pair is invalid.');
  exactKeys(parsed.pair, [
    'pairKey', 'baseToken', 'quoteToken', 'baseTokenRuntimeHash', 'quoteTokenRuntimeHash',
    'privateTokenRuntimeManifestHash', 'privateTokenRuntimeManifestLength',
    'baseDecimals', 'quoteDecimals', 'baseLotSize', 'quoteLotSize', 'maximumAggregateLots',
    'tickTableHash'
  ], 'DEX V2 pair');
  const baseToken = address(parsed.pair.baseToken, 'DEX V2 base token');
  const quoteToken = address(parsed.pair.quoteToken, 'DEX V2 quote token');
  if (BigInt(baseToken) >= BigInt(quoteToken)) {
    throw new Error('DEX V2 pair tokens are not in canonical address order.');
  }
  const expectedPairKey = keccak256(AbiCoder.defaultAbiCoder().encode(
    ['address', 'address'],
    [baseToken, quoteToken]
  )).toLowerCase();
  const pairKey = hash(parsed.pair.pairKey, 'DEX V2 pair key');
  if (pairKey !== expectedPairKey) {
    throw new Error('DEX V2 pair key does not match its canonical token addresses.');
  }
  const pair = Object.freeze({
    pairKey,
    baseToken,
    quoteToken,
    baseTokenRuntimeHash: hash(parsed.pair.baseTokenRuntimeHash, 'DEX V2 base-token runtime hash'),
    quoteTokenRuntimeHash: hash(parsed.pair.quoteTokenRuntimeHash, 'DEX V2 quote-token runtime hash'),
    privateTokenRuntimeManifestHash: hash(
      parsed.pair.privateTokenRuntimeManifestHash,
      'DEX V2 private-token runtime-manifest hash'
    ),
    privateTokenRuntimeManifestLength: integer(
      parsed.pair.privateTokenRuntimeManifestLength,
      'DEX V2 private-token runtime-manifest length',
      256
    ),
    baseDecimals: integer(parsed.pair.baseDecimals, 'DEX V2 base decimals', 18),
    quoteDecimals: integer(parsed.pair.quoteDecimals, 'DEX V2 quote decimals', 18),
    baseLotSize: decimal(parsed.pair.baseLotSize, 'DEX V2 base lot size', (1n << 128n) - 1n),
    quoteLotSize: decimal(parsed.pair.quoteLotSize, 'DEX V2 quote lot size', (1n << 128n) - 1n),
    maximumAggregateLots: decimal(parsed.pair.maximumAggregateLots, 'DEX V2 maximum aggregate lots', (1n << 32n) - 1n),
    tickTableHash: hash(parsed.pair.tickTableHash, 'DEX V2 tick-table hash')
  });

  if (!isRecord(parsed.activation)) throw new Error('DEX V2 activation is invalid.');
  exactKeys(parsed.activation, [
    'result', 'transactionCount', 'measuredRouteCount', 'finalBlock', 'allProofsPassed',
    'routeGasP95Passed', 'routeGasMaximumPassed', 'routeLatencyP95Passed'
  ], 'DEX V2 activation');
  if (parsed.activation.result !== 'pass' || parsed.activation.transactionCount !== 16 ||
      parsed.activation.measuredRouteCount !== 4) {
    throw new Error('DEX V2 activation did not complete the frozen live journey.');
  }
  const activation = Object.freeze({
    result: 'pass' as const,
    transactionCount: 16 as const,
    measuredRouteCount: 4 as const,
    finalBlock: parseBlock(parsed.activation.finalBlock, 'DEX V2 activation final block'),
    allProofsPassed: booleanLiteral(parsed.activation.allProofsPassed, true, 'DEX V2 activation proofs'),
    routeGasP95Passed: booleanLiteral(parsed.activation.routeGasP95Passed, true, 'DEX V2 route p95 gas gate'),
    routeGasMaximumPassed: booleanLiteral(parsed.activation.routeGasMaximumPassed, true, 'DEX V2 route maximum gas gate'),
    routeLatencyP95Passed: booleanLiteral(parsed.activation.routeLatencyP95Passed, true, 'DEX V2 route latency gate')
  });
  if (BigInt(activation.finalBlock.number) < BigInt(deploymentAnchors.pairRegistration.number)) {
    throw new Error('DEX V2 activation final block predates pair registration.');
  }

  const manifestHash = hash(parsed.manifestHash, 'DEX V2 manifest hash');
  const { manifestHash: _ignored, ...body } = parsed;
  if (hashDexV2AppManifestBody(body) !== manifestHash) {
    throw new Error('DEX V2 manifest hash is invalid.');
  }

  const manifest = Object.freeze({
    schemaVersion: 1,
    status: 'activated-testnet',
    network: 'cotiTestnet',
    chainId: COTI_TESTNET_CHAIN_ID,
    productionActivationEvidence: false,
    operator: address(parsed.operator, 'DEX V2 operator'),
    owner: address(parsed.owner, 'DEX V2 owner'),
    deploymentPlanHash: hash(parsed.deploymentPlanHash, 'DEX V2 deployment-plan hash'),
    deploymentCandidateHash: hash(parsed.deploymentCandidateHash, 'DEX V2 deployment-candidate hash'),
    activationPlanHash: hash(parsed.activationPlanHash, 'DEX V2 activation-plan hash'),
    activationReportHash: hash(parsed.activationReportHash, 'DEX V2 activation-report hash'),
    addresses,
    runtimeHashes,
    deploymentAnchors,
    pair,
    activation,
    manifestHash
  }) as DexV2AppManifest;
  MANIFESTS.add(manifest);
  return manifest;
};

export const assertDexV2AppManifest = (manifest: DexV2AppManifest): DexV2AppManifest => {
  if (!manifest || !MANIFESTS.has(manifest)) {
    throw new Error('DEX V2 requires a manifest returned by its exact parser.');
  }
  return manifest;
};

const parseRpcUrl = (value: string): string => {
  try {
    const parsed = new URL(value);
    if (
      parsed.username || parsed.password ||
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
    ) throw new Error('unsupported');
    return parsed.toString();
  } catch {
    throw new Error('DEX V2 RPC URL must be HTTPS or credential-free local HTTP.');
  }
};

export const parseDexV2DeploymentConfig = (
  env: Readonly<Record<string, unknown>>
): DexV2DeploymentConfig => {
  const enabled = env[DEX_V2_ENV_KEYS.enabled];
  if (enabled === undefined || enabled === '' || enabled === 'false') {
    return Object.freeze({ status: 'inactive' });
  }
  if (enabled !== 'true') {
    throw new Error(`${DEX_V2_ENV_KEYS.enabled} must be exactly true or false.`);
  }
  const manifest = parseDexV2AppManifest(required(env, DEX_V2_ENV_KEYS.manifest));
  const finalityLagBlocks = BigInt(decimal(
    required(env, DEX_V2_ENV_KEYS.finalityLagBlocks),
    'DEX V2 finality lag',
    4_096n
  ));
  const rpcUrl = parseRpcUrl(required(env, DEX_V2_ENV_KEYS.rpcUrl));
  return Object.freeze({
    status: 'active',
    manifest,
    finalityLagBlocks,
    rpcUrl,
    fingerprint: [
      'chainwhisper-dex-v2-activated-testnet',
      manifest.manifestHash,
      manifest.deploymentCandidateHash,
      manifest.activationReportHash,
      manifest.activation.finalBlock.number,
      manifest.activation.finalBlock.hash,
      finalityLagBlocks.toString(),
      rpcUrl
    ].join(':')
  });
};

export const resolveDexV2DeploymentConfig = (
  env: Readonly<Record<string, unknown>>
): DexV2DeploymentConfig => {
  try {
    return parseDexV2DeploymentConfig(env);
  } catch {
    return Object.freeze({ status: 'invalid', error: 'ChainWhisper DEX V2 deployment configuration is invalid.' });
  }
};

export const DEX_V2_DEPLOYMENT_CONFIG = resolveDexV2DeploymentConfig(import.meta.env);

// The admitted Pool pair is address-sorted, unlike the app's swap token list.
// Funding budgets, price B/A, preview values and private debits use this order.
export const CURRENT_CHEAP_POOL_TOKENS = Object.freeze([
  CURRENT_CHEAP_DEX_CANDIDATE.tokens[1], CURRENT_CHEAP_DEX_CANDIDATE.tokens[0]
] as const);
