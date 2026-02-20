// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.19;

import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";

/**
 * GroupChatManager
 * Single-contract group chat manager for COTI gcEVM.
 *
 * Design:
 * - One contract handles all groups (groupId => metadata + members).
 * - Sender submits one encrypted message payload (itString).
 * - Contract offboards encrypted views per member (utString) and emits delivery events.
 * - Public fee model similar to single-chat contract:
 *   msg.value must be >= feeAmount; fee goes to feeRecipient, remainder is refunded to sender.
 */
contract GroupChatManager {
    address public owner;
    address public feeRecipient;
    uint256 public feeAmount;
    bool public paused;
    uint256 private _locked;

    uint256 public nextGroupId = 1;

    uint256 public constant MAX_GROUP_MEMBERS = 64;
    uint256 public constant GROUP_TITLE_MAX_BYTES = 64;

    struct Group {
        address admin;
        uint64 createdAt;
        uint32 memberCount;
        string title;
        bool exists;
    }

    mapping(uint256 => Group) private _groups;
    mapping(uint256 => address[]) private _groupMembers;
    mapping(uint256 => mapping(address => bool)) public isMember;
    mapping(uint256 => mapping(address => uint256)) private _memberIndexPlusOne;
    mapping(uint256 => uint256) public lastBlockForGroup;
    mapping(uint256 => uint256) public lastTimestampForGroup;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeeRecipientSet(address indexed feeRecipient);
    event FeeAmountSet(uint256 feeAmount);
    event Paused();
    event Unpaused();

    event GroupCreated(uint256 indexed groupId, address indexed admin, string title);
    event GroupAdminChanged(uint256 indexed groupId, address indexed previousAdmin, address indexed newAdmin);
    event GroupTitleUpdated(uint256 indexed groupId, string title);
    event GroupMemberAdded(uint256 indexed groupId, address indexed account);
    event GroupMemberRemoved(uint256 indexed groupId, address indexed account);
    event GroupMemberLeft(uint256 indexed groupId, address indexed account);

    // Sender-side event (decryptable by sender).
    event GroupMessageSubmitted(
        uint256 indexed groupId,
        address indexed from,
        utString messageForSender,
        uint256 valueSent,
        uint256 feeTaken
    );

    // Recipient-side event (decryptable by recipient).
    event GroupMessageDelivered(
        uint256 indexed groupId,
        address indexed from,
        address indexed recipient,
        utString messageForRecipient
    );

    error OnlyOwner();
    error OnlyGroupAdmin();
    error InvalidAddress();
    error InvalidFeeRecipient();
    error InvalidGroup();
    error NotGroupMember();
    error GroupPaused();
    error ReentrancyGuard();
    error InsufficientFee();
    error TransferFailed();
    error GroupTooLarge();
    error InvalidGroupTitle();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert GroupPaused();
        _;
    }

    modifier nonReentrant() {
        if (_locked != 0) revert ReentrancyGuard();
        _locked = 1;
        _;
        _locked = 0;
    }

    modifier onlyGroupAdmin(uint256 groupId) {
        Group storage group = _groups[groupId];
        if (!group.exists) revert InvalidGroup();
        if (group.admin != msg.sender) revert OnlyGroupAdmin();
        _;
    }

    constructor(address initialOwner_, address initialFeeRecipient_, uint256 initialFeeAmount_) {
        if (initialOwner_ == address(0)) revert InvalidAddress();
        if (initialFeeRecipient_ == address(0)) revert InvalidFeeRecipient();

        owner = initialOwner_;
        feeRecipient = initialFeeRecipient_;
        feeAmount = initialFeeAmount_;

        emit OwnershipTransferred(address(0), initialOwner_);
        emit FeeRecipientSet(initialFeeRecipient_);
        emit FeeAmountSet(initialFeeAmount_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        if (newFeeRecipient == address(0)) revert InvalidFeeRecipient();
        feeRecipient = newFeeRecipient;
        emit FeeRecipientSet(newFeeRecipient);
    }

    function setFeeAmount(uint256 newFeeAmount) external onlyOwner {
        feeAmount = newFeeAmount;
        emit FeeAmountSet(newFeeAmount);
    }

    function pause() external onlyOwner {
        if (paused) return;
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        if (!paused) return;
        paused = false;
        emit Unpaused();
    }

    function createGroup(string calldata title, address[] calldata initialMembers) external whenNotPaused returns (uint256 groupId) {
        string memory sanitizedTitle = _sanitizeGroupTitle(title);
        groupId = nextGroupId++;

        Group storage group = _groups[groupId];
        group.admin = msg.sender;
        group.createdAt = uint64(block.timestamp);
        group.memberCount = 0;
        group.title = sanitizedTitle;
        group.exists = true;

        _addMember(groupId, msg.sender);
        for (uint256 i = 0; i < initialMembers.length; i++) {
            _addMember(groupId, initialMembers[i]);
        }

        emit GroupCreated(groupId, msg.sender, sanitizedTitle);
    }

    function setGroupAdmin(uint256 groupId, address newAdmin) external onlyGroupAdmin(groupId) {
        if (newAdmin == address(0)) revert InvalidAddress();
        if (!isMember[groupId][newAdmin]) revert NotGroupMember();

        Group storage group = _groups[groupId];
        address previousAdmin = group.admin;
        group.admin = newAdmin;
        emit GroupAdminChanged(groupId, previousAdmin, newAdmin);
    }

    function setGroupTitle(uint256 groupId, string calldata nextTitle) external onlyGroupAdmin(groupId) {
        string memory sanitizedTitle = _sanitizeGroupTitle(nextTitle);
        _groups[groupId].title = sanitizedTitle;
        emit GroupTitleUpdated(groupId, sanitizedTitle);
    }

    function addMembers(uint256 groupId, address[] calldata accounts) external onlyGroupAdmin(groupId) {
        for (uint256 i = 0; i < accounts.length; i++) {
            _addMember(groupId, accounts[i]);
        }
    }

    function removeMember(uint256 groupId, address account) external onlyGroupAdmin(groupId) {
        if (account == address(0)) revert InvalidAddress();
        if (_groups[groupId].admin == account) revert OnlyGroupAdmin();
        _removeMember(groupId, account);
        emit GroupMemberRemoved(groupId, account);
    }

    function leaveGroup(uint256 groupId) external {
        Group storage group = _groups[groupId];
        if (!group.exists) revert InvalidGroup();
        if (!isMember[groupId][msg.sender]) revert NotGroupMember();
        if (group.admin == msg.sender) revert OnlyGroupAdmin();

        _removeMember(groupId, msg.sender);
        emit GroupMemberLeft(groupId, msg.sender);
    }

    function submitGroupMessage(
        uint256 groupId,
        itString calldata encryptedMessage
    ) external payable whenNotPaused nonReentrant {
        Group storage group = _groups[groupId];
        if (!group.exists) revert InvalidGroup();
        if (!isMember[groupId][msg.sender]) revert NotGroupMember();
        if (msg.value < feeAmount) revert InsufficientFee();

        gtString memory validatedMessage = MpcCore.validateCiphertext(encryptedMessage);
        utString memory messageForSender = MpcCore.offBoardCombined(validatedMessage, msg.sender);

        emit GroupMessageSubmitted(groupId, msg.sender, messageForSender, msg.value, feeAmount);

        address[] storage members = _groupMembers[groupId];
        for (uint256 i = 0; i < members.length; i++) {
            address recipient = members[i];
            if (recipient == msg.sender) {
                continue;
            }
            utString memory messageForRecipient = MpcCore.offBoardCombined(validatedMessage, recipient);
            emit GroupMessageDelivered(groupId, msg.sender, recipient, messageForRecipient);
        }

        lastBlockForGroup[groupId] = block.number;
        lastTimestampForGroup[groupId] = block.timestamp;

        uint256 value = msg.value;
        uint256 fee = feeAmount < value ? feeAmount : value;
        uint256 refund = value - fee;

        if (fee > 0) {
            (bool feeOk, ) = payable(feeRecipient).call{value: fee}("");
            if (!feeOk) revert TransferFailed();
        }
        if (refund > 0) {
            (bool refundOk, ) = payable(msg.sender).call{value: refund}("");
            if (!refundOk) revert TransferFailed();
        }
    }

    function getGroupInfo(uint256 groupId)
        external
        view
        returns (
            address admin,
            uint64 createdAt,
            uint32 memberCount,
            string memory title,
            uint256 lastBlock,
            uint256 lastTimestamp
        )
    {
        Group storage group = _groups[groupId];
        if (!group.exists) revert InvalidGroup();
        return (
            group.admin,
            group.createdAt,
            group.memberCount,
            group.title,
            lastBlockForGroup[groupId],
            lastTimestampForGroup[groupId]
        );
    }

    function getGroupMembers(uint256 groupId) external view returns (address[] memory) {
        if (!_groups[groupId].exists) revert InvalidGroup();
        return _groupMembers[groupId];
    }

    function _addMember(uint256 groupId, address account) internal {
        if (account == address(0)) revert InvalidAddress();
        if (isMember[groupId][account]) {
            return;
        }

        Group storage group = _groups[groupId];
        if (group.memberCount >= MAX_GROUP_MEMBERS) revert GroupTooLarge();

        _groupMembers[groupId].push(account);
        _memberIndexPlusOne[groupId][account] = _groupMembers[groupId].length;
        isMember[groupId][account] = true;
        group.memberCount += 1;
        emit GroupMemberAdded(groupId, account);
    }

    function _removeMember(uint256 groupId, address account) internal {
        if (!isMember[groupId][account]) {
            return;
        }

        uint256 indexPlusOne = _memberIndexPlusOne[groupId][account];
        if (indexPlusOne == 0) {
            return;
        }

        address[] storage members = _groupMembers[groupId];
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = members.length - 1;
        if (index != lastIndex) {
            address moved = members[lastIndex];
            members[index] = moved;
            _memberIndexPlusOne[groupId][moved] = index + 1;
        }

        members.pop();
        delete _memberIndexPlusOne[groupId][account];
        isMember[groupId][account] = false;
        _groups[groupId].memberCount -= 1;
    }

    function _sanitizeGroupTitle(string calldata value) internal pure returns (string memory) {
        bytes calldata raw = bytes(value);
        uint256 len = raw.length;
        if (len > GROUP_TITLE_MAX_BYTES) revert InvalidGroupTitle();

        uint256 start = 0;
        while (start < len && (uint8(raw[start]) <= 0x20 || raw[start] == 0x7F)) start++;
        uint256 end = len;
        while (end > start && (uint8(raw[end - 1]) <= 0x20 || raw[end - 1] == 0x7F)) end--;
        if (start >= end) revert InvalidGroupTitle();

        uint256 outLen = end - start;
        if (outLen > GROUP_TITLE_MAX_BYTES) revert InvalidGroupTitle();
        bytes memory out = new bytes(outLen);
        for (uint256 i = 0; i < outLen; i++) {
            bytes1 c = raw[start + i];
            if (uint8(c) <= 0x20 || c == 0x7F) revert InvalidGroupTitle();
            if (c == "<" || c == ">" || c == 0x22 || c == 0x27 || c == "&" || c == "\\") revert InvalidGroupTitle();
            out[i] = c;
        }
        return string(out);
    }
}
