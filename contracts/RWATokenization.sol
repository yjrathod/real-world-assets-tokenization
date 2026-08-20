// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RWATokenization {
    struct Asset {
        uint256 id;
        string name;
        string assetType;
        uint256 value;
        uint256 totalTokens;
        uint256 tokenPrice;
        address issuer;
    }

    address public owner;

    uint256 public assetCount;
    mapping(uint256 => Asset) public assets;
    mapping(uint256 => mapping(address => uint256)) public balances;

    event AssetCreated(
        uint256 indexed assetId,
        string name,
        address indexed issuer
    );

    event TokensPurchased(
        uint256 indexed assetId,
        address indexed investor,
        uint256 tokenAmount,
        uint256 amountPaid
    );

    constructor() {
        owner = msg.sender;
    }

    function createAsset(
        string memory _name,
        string memory _assetType,
        uint256 _value,
        uint256 _totalTokens,
        uint256 _tokenPrice
    ) public {
        require(_totalTokens > 0, "Token supply must be greater than 0");
        require(_tokenPrice > 0, "Token price must be greater than 0");

        assetCount++;

        assets[assetCount] = Asset({
            id: assetCount,
            name: _name,
            assetType: _assetType,
            value: _value,
            totalTokens: _totalTokens,
            tokenPrice: _tokenPrice,
            issuer: msg.sender
        });

        emit AssetCreated(assetCount, _name, msg.sender);
    }

    function getAsset(uint256 _assetId) public view returns (Asset memory) {
        require(_assetId > 0 && _assetId <= assetCount, "Asset does not exist");

        return assets[_assetId];
    }

    function getInvestorBalance(
        uint256 _assetId,
        address _investor
    ) public view returns (uint256) {
        return balances[_assetId][_investor];
    }

    function getIssuerBalance(
        uint256 _assetId,
        address _wallet
    ) public view returns (uint256) {
        return balances[_assetId][_wallet];
    }

    function availableTokens(uint256 _assetId) public view returns (uint256) {
        Asset memory asset = assets[_assetId];

        return asset.totalTokens - totalSold[_assetId];
    }

    mapping(uint256 => uint256) public totalSold;

    function buyTokens(uint256 _assetId, uint256 _tokenAmount) public payable {
        require(_assetId > 0 && _assetId <= assetCount, "Asset does not exist");

        Asset memory asset = assets[_assetId];

        require(_tokenAmount > 0, "Invalid token amount");

        require(
            totalSold[_assetId] + _tokenAmount <= asset.totalTokens,
            "Not enough tokens available"
        );

        uint256 requiredPayment = _tokenAmount * asset.tokenPrice;

        require(msg.value == requiredPayment, "Incorrect ETH payment");

        balances[_assetId][msg.sender] += _tokenAmount;
        totalSold[_assetId] += _tokenAmount;

        emit TokensPurchased(_assetId, msg.sender, _tokenAmount, msg.value);
    }

}
