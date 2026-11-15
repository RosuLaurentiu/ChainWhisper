// Local visual fixture: synthetic fields, no wallet, provider or send path.
import { useState, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import QuickActionsModal from '../../../src/features/chat/components/QuickActionsModal';
import { useChatUiStore } from '../../../src/features/chat/chatUiStore';
import { GroupInviteMenu } from '../../../src/features/groups/components/GroupInviteTools';
import CurrentSwapSteps from '../../../src/features/dex/components/CurrentSwapSteps';
import AppHeader from '../../../src/app/components/AppHeader';
import { AppHeaderNavigation } from '../../../src/app/components/AppHeaderNavigation';
import TradingProductSwitch from '../../../src/app/components/TradingProductSwitch';
import OtcOffersPanel from '../../../src/features/trading/components/OtcOffersPanel';
import TokenSwapPage from '../../../src/features/tokenTools/components/TokenSwapPage';
import GroupChatPanel from '../../../src/features/groups/components/GroupChatPanel';
import ContactsSidebar from '../../../src/features/chat/components/ContactsSidebar';
import { PRIVACY_TOKEN_PAIRS } from '../../../src/lib/privacyPortal';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from '../../../src/lib/dexV2Deployment';
import '../../../src/styles.css';

useChatUiStore.setState({quickActionTab:'create-group'});
const noop=()=>{};
const asyncNoop=async()=>{};
const sampleWallet='0x1111111111111111111111111111111111111111';
function LocalHeader(){return <AppHeader headerRef={{current:null}} mobileLinksOpen={false} isMobileNav={false}
  onToggleMobileLinksOpen={noop} onCloseMobileLinks={noop} subtitle="Local fixture · no wallet"
  appNavigationControl={<AppHeaderNavigation activePage="dex" onNavigate={noop}/>}/>;}

function MarketFixture({p2p=false}:{p2p?:boolean}){
  return <div className={`app-shell ${p2p?'app-shell-trades':'app-shell-dex-v2'}`}>
    <LocalHeader/>
    <TradingProductSwitch activeProduct="dex" dexCandidate={STAGED_SHARED_HISTORY_DEX_CANDIDATE} selectedPair={['BCN','HBR']} onSelectedPairChange={noop}
      onNavigate={noop} priceDisplayInverted={false} onPriceDisplayInvertedChange={noop}
      marketReference={{status:'available',price:1.44718,sampledAt:String(Math.floor(Date.now()/1000)),checkedAt:String(Math.floor(Date.now()/1000)),revision:'local-fixture'}}/>
    {p2p ? <main className="standalone-trades-shell p2p-trading-shell p2p-trading-shell-create p2p-trading-shell-create-with-offers">
      <section className="p2p-create-overview"><div className="p2p-create-overview-head"><div className="p2p-create-tabs"><div className="p2p-product-navigation"><div className="p2p-trade-tabs"><button>Offers</button><button className="active">Create</button><button>My trades</button></div></div></div></div></section>
      <OtcOffersPanel actionMode="buy" linkedActionModes={{buy:true,sell:true}} pinnedTrade={null} pinnedTradeKey=""
        sellTokenSelection="custom" buyTokenSelection="custom" tokenOptions={[]} displayQuote={null} bestQuote={null}
        quoteCandidates={[]} carbonReference={null} priceDisplayInverted={false} marketLabel="BCN / HBR"
        filtersOpen={false} filtersActive={false} filterResultSummary="0 offers" loadingOffers={false} offersError=""
        typeFilter="all" typeFilterOptions={[{value:'all',label:'All offers'}]} onActionModeChange={noop}
        onToggleFilters={noop} onTypeFilterChange={noop} onClearFilters={noop} onRetryOffers={noop}
        onOpenTradeLink={noop} onClearPinnedOrder={noop} onCreateLimitOrder={noop} onOpenQuote={noop} formatAvailability={()=>'Unavailable'}/>
      <section className="standalone-trade-create-panel p2p-trade-workspace-panel"><div className="standalone-trades-section-head"><h2>Create P2P offer</h2></div>
        <div className="trade-compose-panel"><p>Local layout fixture. No provider or send path.</p><label>Price<input placeholder="0"/></label><label>You sell HBR<input placeholder="0"/></label><label>You buy BCN<input placeholder="0"/></label><button disabled>Create Offer</button></div>
      </section>
    </main> : <main className="dex-v2-page"><h1>Local market context</h1><p>No wallet or provider.</p></main>}
  </div>;
}

function PortalFixture(){return <div className="app-shell app-shell-swap" style={{display:'block'}}><LocalHeader/>
  <TokenSwapPage pairs={PRIVACY_TOKEN_PAIRS} selectedPair={PRIVACY_TOKEN_PAIRS[0]} onPairChange={noop}
    tokenSearch="" onTokenSearchChange={noop} privacyDirection="public-to-private" onPrivacyDirectionChange={noop}
    amountInput="" onAmountInputChange={noop} onMaxAmount={noop} metrics={null} quote={null} loading={false}
    actionStage={null} walletAddress={sampleWallet} onCotiNetwork={false} hasAesReady canConvert={false}
    buttonLabel="Unavailable" onConvert={asyncNoop} onRefresh={noop} statusMessage="" error="Switch to COTI Mainnet and try again."/>
</div>;}

function GroupHistoryFixture({preserved=false}:{preserved?:boolean}){
  const props:ComponentProps<typeof GroupChatPanel>={
    activeGroupId:6,activeGroupMeta:{id:6,admin:sampleWallet,title:'Local group',isPrivate:true,createdAt:1,memberCount:1,members:[],membersLoaded:false,lastBlock:1,lastTimestamp:1},
    isActiveGroupAdmin:true,activeGroupMemberCount:1,activeGroupParticipants:[],lastCopiedKey:null,onCopyWithFeedback:asyncNoop,
    processingGroupAction:false,onRemoveMember:asyncNoop,onTransferAdmin:asyncNoop,adminTransferEnabled:false,
    desktopInviteMenu:null,mobileInviteTools:null,desktopGroupActions:null,mobileGroupActions:null,isMobileNav:false,
    mobileGroupOptionsOpen:false,onToggleMobileGroupOptions:noop,chatMessagesRef:{current:null},activeGroupMessages:preserved?[{
      id:'synthetic-retained-message',direction:'incoming',text:'Synthetic retained group history',senderAddress:sampleWallet,
      groupV2:{protocol:'group-v2',contentState:'available',chainId:'7082400',contractAddress:sampleWallet,groupId:'6',
        messageId:'2',epoch:'1',membershipRevision:'2',senderSequence:'1',nonce:`0x${'22'.repeat(12)}`,
        transactionHash:`0x${'33'.repeat(32)}`,blockNumber:'100',blockHash:`0x${'44'.repeat(32)}`,logIndex:0,finality:'confirmed'}
    }]:[],
    messageLoadPhase:null,historyUnavailable:true,groupEpochSyncRequired:false,groupEpochSyncPending:false,onSynchronizeGroupEpoch:noop,
    isReactionOnlyMessage:()=>false,getReactionsForMessage:()=>[],reactionPickerMessageId:null,onToggleReactionPicker:noop,
    sendingReaction:false,onSendReaction:asyncNoop,walletPromptSensitiveActionsDisabled:true,walletPromptSensitiveActionsTitle:'Local fixture',
    chatReactionsV1Enabled:false,groupChatV2RepliesEnabled:false,replyingToMessage:null,onReplyToMessage:noop,highlightedMessageId:null,
    messageElementRefs:{current:{}},onJumpToReferencedMessage:noop,getReplyReferenceFallbackLabel:()=>'',walletAddress:sampleWallet,
    findContactNameForWalletAddress:()=>undefined,replyingPreviewText:'',onCancelReply:noop,tipComposerOpen:false,onToggleTipComposer:noop,
    tipping:false,tipTokenSelection:'coti',onTipTokenSelectionChange:noop,rewardTokenSymbol:'WISP',privateRewardTokenSymbol:'pWISP',
    tipAmountInput:'',onTipAmountInputChange:noop,activeTipTokenSymbol:'COTI',tipAmountWeiFromInput:0n,canSendGroupTipFromComposer:false,
    tipAmountExceedsBalance:false,tipAmountSummaryLabel:'',tipBalanceSummaryLabel:'',onSendTip:noop,groupTipRecipientAddress:'',
    onGroupTipRecipientChange:noop,activeGroupTipRecipients:[],selectedGroupTipRecipient:null,sendingGroupMessage:false,
    composerRef:{current:null},onSendImage:noop,uploadingImage:false,imageAttachDisabled:true,imageAttachTitle:'Local fixture',
    onDismissImageAttachmentStatus:noop,onSendMessage:noop,maxMessageLength:1024,onMessageInputChange:noop,onOpenInternalAppLink:noop
  };
  return <div className="app-shell app-shell-chat" style={{display:'block',padding:24,height:'100dvh'}}><GroupChatPanel {...props}/></div>;
}
function MembershipFixture({state}:{state:'ready'|'loading'|'error'}){
  const group={id:7,title:'Synthetic current group',isPrivate:true,memberCount:2,lastTimestamp:100,
    admin:sampleWallet,createdAt:0,members:[],membersLoaded:false,lastBlock:0};
  return <div className="app-shell app-shell-chat" style={{display:'block',padding:24,height:'100dvh'}}>
    <ContactsSidebar nicknameEditorRef={{current:null}} nicknameMaxBytes={32} hasAesReady canSavePublicName={false}
      walletAddress={sampleWallet} onNicknameInputChange={noop} onSaveNickname={noop} hasUnreadConversations={false}
      readStateActionsDisabled walletPromptSensitiveActionsTitle="Synthetic fixture" onMarkAllConversationsAsRead={noop}
      onForceSync={noop} syncingHistory={false} syncingGroups={false} refreshingContacts={false} canRefreshContacts
      onOpenNewChat={noop} showHiddenContacts={false} onToggleShowHiddenContacts={noop} hiddenContactsCount={0}
      hiddenContactsLabel="hidden chats" contactGroupPanelRatio={{contactsPanelFlex:1,groupsPanelFlex:1}}
      visibleSortedContacts={[]} contactsListEmptyMessage="No synthetic contacts." activeContact={null}
      isConversationStateSyncPending={()=>false} conversationMetadataActionsDisabled messagesByContact={{}}
      lastCopiedKey={null} unreadMap={{}} onCopyWithFeedback={asyncNoop} onActivateContact={noop} onRemoveContact={noop}
      sortedGroupInvites={[]} onAcceptGroupInvite={noop} onDeclineGroupInvite={noop} processingGroupAction={false}
      sortedGroups={[{...group,id:4,title:'Synthetic ended group',membershipEnded:true},group]}
      groupDiscoveryState={state} activeGroupId={null} messagesByGroup={{}} unreadGroupMap={{}} onActivateGroup={noop} error=""/>
  </div>;
}
function Fixture(){
  const [open,setOpen]=useState(false),[title,setTitle]=useState(''),[members,setMembers]=useState(''),[privateGroup,setPrivate]=useState(false),[hours,setHours]=useState('8');
  const surface=new URLSearchParams(location.search).get('surface');
  if(surface==='market')return <MarketFixture/>;
  if(surface==='p2p')return <MarketFixture p2p/>;
  if(surface==='portal')return <PortalFixture/>;
  if(surface==='history')return <GroupHistoryFixture/>;
  if(surface==='history-preserved')return <GroupHistoryFixture preserved/>;
  if(surface==='membership-ready'||surface==='membership-loading'||surface==='membership-error')return <MembershipFixture state={surface==='membership-ready'?'ready':surface==='membership-loading'?'loading':'error'}/>;
  return <div className="app-shell app-shell-chat" style={{display:'block',padding:24}}>
    <h1>Local UI verification</h1><p>Synthetic fields. No wallet or send path.</p>
    <button onClick={()=>setOpen(true)}>Create group preview</button>
    <div className="chat-panel" style={{marginTop:24,padding:24,height:'auto',minHeight:220,overflow:'visible'}}>
      <GroupInviteMenu activeGroupId={1} walletAddress="0x1111111111111111111111111111111111111111"
        canInviteToActiveGroup={surface!=='invite-unavailable'&&surface!=='invite-denied'} canManageActiveGroupJoinCodes={false} groupInviteMenuView="invite" onGroupInviteMenuViewChange={noop}
        groupInviteMembersInput={members} onGroupInviteMembersInputChange={setMembers} groupInviteTtlInput={hours} onGroupInviteTtlInputChange={setHours}
        onInviteMembers={noop} groupJoinCodeMode="single" onGroupJoinCodeModeChange={noop} groupJoinCodeMaxUsesInput="1" onGroupJoinCodeMaxUsesInputChange={noop}
        onGenerateJoinCode={noop} generatedGroupInviteCode="" generatedGroupJoinCodeHash="" onRevokeGeneratedJoinCode={noop}
        lastCopiedKey={null} onCopyWithFeedback={noop} processingGroupAction={false} hasAesReady={surface!=='invite-locked'} isActiveGroupAdmin={surface!=='invite-denied'}/>
    </div>
    <div className="dex-v2-current-swap" style={{marginTop:24,maxWidth:720}}>
      <CurrentSwapSteps profile="cheap-async" inputs={{completed:4,total:4,requesting:false}} restored={false} privacyReady
        approval="not-needed" quote="verified" accept="next" stage="released" work={{completed:0,total:4}} reviewReady={false} delivered scopeChanged={false}/>
    </div>
    <QuickActionsModal isOpen={open} onClose={()=>setOpen(false)} newContact="" onNewContactChange={noop} onAddContactSubmit={e=>e.preventDefault()}
      newGroupTitle={title} onNewGroupTitleChange={setTitle} newGroupMembersInput={members} onNewGroupMembersInputChange={setMembers}
      newGroupIsPrivate={privateGroup} onNewGroupIsPrivateChange={setPrivate} onCreateGroup={async()=>{}}
      processingGroupAction={false} hasAesReady groupJoinCodeInput="" onGroupJoinCodeInputChange={noop} onJoinGroupWithCode={async()=>{}} error=""/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
