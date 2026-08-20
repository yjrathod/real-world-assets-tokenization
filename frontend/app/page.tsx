"use client";

import { FormEvent, useMemo, useState } from "react";
import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";

const ADDRESS = "0xFE1Df42B609d6B14cE53b4BFf095cdF579508BBC";
const ABI = [
  "function assetCount() view returns (uint256)",
  "function getAsset(uint256) view returns (tuple(uint256 id,string name,string assetType,uint256 value,uint256 totalTokens,uint256 tokenPrice,address issuer))",
  "function availableTokens(uint256) view returns (uint256)",
  "function getInvestorBalance(uint256,address) view returns (uint256)",
  "function createAsset(string,string,uint256,uint256,uint256)",
  "function buyTokens(uint256,uint256) payable",
] as const;

type View = "home" | "issuer" | "investor" | "verify";

type Asset = {
  id: number;
  name: string;
  assetType: string;
  value: string;
  totalTokens: number;
  tokenPrice: bigint;
  issuer: string;
  available: number;
};

type EthWindow = Window & {
  ethereum?: {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  };
};

const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const eth = (a: bigint) =>
  Number(formatEther(a)).toLocaleString(undefined, { maximumFractionDigits: 5 });

const SEPOLIA_CHAIN_ID = "0xaa36a7"; // 11155111
const SEPOLIA_CHAIN_ID_DECIMAL = 11155111;

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [account, setAccount] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [verified, setVerified] = useState<number[]>([]);
  const [balances, setBalances] = useState<Record<number, number>>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [newAssetValue, setNewAssetValue] = useState("");
  const [newTokenCount, setNewTokenCount] = useState("");

  const selected = assets.find((a) => a.id === Number(assetId));

  const getEthereum = () => {
    const ethereum = (window as EthWindow).ethereum;
    if (!ethereum) {
      throw new Error("MetaMask was not found. Please install MetaMask.");
    }
    return ethereum;
  };

  const ensureSepolia = async () => {
    const ethereum = getEthereum();

    const currentChainId = (await ethereum.request({
      method: "eth_chainId",
    })) as string;

    if (currentChainId === SEPOLIA_CHAIN_ID) return;

    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_CHAIN_ID }],
      });
    } catch (error: any) {
      if (error?.code === 4902) {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: SEPOLIA_CHAIN_ID,
              chainName: "Sepolia Test Network",
              nativeCurrency: {
                name: "SepoliaETH",
                symbol: "ETH",
                decimals: 18,
              },
              rpcUrls: ["https://rpc.sepolia.org"],
              blockExplorerUrls: ["https://sepolia.etherscan.io"],
            },
          ],
        });
      } else {
        throw new Error(
          "Please switch MetaMask to the Sepolia test network to continue."
        );
      }
    }

    // Final safety check
    const finalChainId = (await ethereum.request({
      method: "eth_chainId",
    })) as string;

    if (finalChainId !== SEPOLIA_CHAIN_ID) {
      throw new Error(
        "Failed to switch to Sepolia. Please select Sepolia manually in MetaMask."
      );
    }
  };

  const contract = async (withSigner = false) => {
    await ensureSepolia();

    const ethereum = getEthereum();
    const provider = new BrowserProvider(ethereum);

    const network = await provider.getNetwork();
    if (Number(network.chainId) !== SEPOLIA_CHAIN_ID_DECIMAL) {
      throw new Error(
        `Wrong network detected (${network.chainId}). Please switch to Sepolia.`
      );
    }

    if (withSigner) {
      const signer = await provider.getSigner();
      return new Contract(ADDRESS, ABI, signer);
    }

    return new Contract(ADDRESS, ABI, provider);
  };

  const refresh = async (wallet = account) => {
    try {
      const c = await contract();
      const count = Number(await c.assetCount());

      const list = await Promise.all(
        Array.from({ length: count }, async (_, i) => {
          const x = await c.getAsset(i + 1);
          return {
            id: Number(x.id),
            name: x.name,
            assetType: x.assetType,
            value: x.value.toString(),
            totalTokens: Number(x.totalTokens),
            tokenPrice: x.tokenPrice,
            issuer: x.issuer,
            available: Number(await c.availableTokens(i + 1)),
          };
        })
      );

      setAssets(list);

      if (wallet) {
        const next: Record<number, number> = {};
        await Promise.all(
          list.map(async (a) => {
            next[a.id] = Number(await c.getInvestorBalance(a.id, wallet));
          })
        );
        setBalances(next);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not load contract data.");
    }
  };

  const connect = async () => {
    try {
      const ethereum = getEthereum();
      await ensureSepolia();

      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];

      setAccount(accounts[0]);
      setNotice("Connected to Sepolia testnet. Loading assets…");
      await refresh(accounts[0]);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Wallet connection was cancelled.");
    }
  };

  const calculatedPrice =
    newAssetValue && Number(newTokenCount) > 0
      ? parseEther(newAssetValue) / BigInt(newTokenCount)
      : BigInt(0);

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);

    if (!calculatedPrice) {
      return setNotice("Enter an asset value and total number of tokens.");
    }

    setBusy(true);
    try {
      const c = await contract(true);
      const tx = await c.createAsset(
        String(f.get("name")),
        String(f.get("type")),
        parseEther(newAssetValue),
        BigInt(newTokenCount),
        calculatedPrice
      );

      setNotice("Creating asset… please confirm in MetaMask (Sepolia).");
      await tx.wait();

      e.currentTarget.reset();
      setNewAssetValue("");
      setNewTokenCount("");
      await refresh();
      setNotice("Asset created successfully on Sepolia.");
    } catch (x) {
      setNotice(x instanceof Error ? x.message : "Asset could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const buy = async (a: Asset) => {
    const n = Number(amounts[a.id]);
    if (!Number.isInteger(n) || n < 1) {
      return setNotice("Enter a whole number of tokens.");
    }
    if (n > a.available) {
      return setNotice("That amount is more than the tokens available.");
    }

    setBusy(true);
    try {
      const c = await contract(true);
      const tx = await c.buyTokens(a.id, n, {
        value: a.tokenPrice * BigInt(n),
      });

      setNotice("Purchase sent. Confirm it in MetaMask (Sepolia).");
      await tx.wait();
      await refresh();
      setNotice("Investment successful — ownership updated on Sepolia.");
    } catch (x) {
      setNotice(x instanceof Error ? x.message : "Purchase could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const total = useMemo(
    () =>
      assets.reduce(
        (s, a) => s + a.tokenPrice * BigInt(balances[a.id] || 0),
        BigInt(0)
      ),
    [assets, balances]
  );

  const status = (id: number) => (
    <span className={"status " + (verified.includes(id) ? "verified" : "pending")}>
      <i />
      {verified.includes(id) ? "Verified" : "Unverified"}
    </span>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("home")}>
          <span className="brand-mark">R</span> RWA
        </button>
        <nav>
          {(["issuer", "investor", "verify"] as View[]).map((x) => (
            <button
              key={x}
              className={view === x ? "active" : ""}
              onClick={() => setView(x)}
            >
              {x === "verify" ? "Verify" : x[0].toUpperCase() + x.slice(1)}
            </button>
          ))}
        </nav>
        <span className="network-badge">● Sepolia testnet</span>
        <button className="wallet-button" onClick={connect}>
          {account ? short(account) : "Connect wallet"}
        </button>
      </header>

      {notice && (
        <div className="notice">
          <span>●</span>
          {notice}
          <button onClick={() => setNotice("")}>×</button>
        </div>
      )}

      {view === "home" && (
        <section className="hero">
          <div className="eyebrow">COLLEGE PROJECT · TESTNET ETH</div>
          <h1>
            Invest in real things,
            <br />
            <em>one token at a time.</em>
          </h1>
          <p>
            A simple demonstration of how a real-world asset can be split into
            digital tokens, verified, and opened to investors.
          </p>
          <div className="hero-actions">
            <button className="primary" onClick={() => setView("issuer")}>
              Open issuer dashboard <b>→</b>
            </button>
            <button className="secondary" onClick={() => setView("investor")}>
              Browse investments
            </button>
          </div>
          <button className="text-link" onClick={() => setView("verify")}>
            Already have an Asset ID? Verify it here →
          </button>
        </section>
      )}

      {view === "issuer" && (
        <section className="dashboard">
          <Heading
            tag="ISSUER AREA"
            title="List a real-world asset"
            text="Create an asset on the testnet. Token price is calculated automatically."
            action={() => void refresh()}
          />
          <div className="issuer-layout">
            <form className="card asset-form" onSubmit={create}>
              <h3>New asset details</h3>
              <label>
                Asset name
                <input
                  required
                  name="name"
                  placeholder="e.g. Greenfield Apartment"
                />
              </label>
              <label>
                Asset type
                <input required name="type" placeholder="e.g. Real Estate" />
              </label>
              <div className="form-row">
                <label>
                  Asset value (test ETH)
                  <input
                    required
                    name="value"
                    value={newAssetValue}
                    onChange={(e) => setNewAssetValue(e.target.value)}
                    type="number"
                    step="0.000001"
                    min="0.000001"
                    placeholder="1"
                  />
                </label>
                <label>
                  Total tokens
                  <input
                    required
                    name="tokens"
                    value={newTokenCount}
                    onChange={(e) => setNewTokenCount(e.target.value)}
                    type="number"
                    min="1"
                    placeholder="1000"
                  />
                </label>
              </div>
              <div className="calculated-price">
                <span>Price per token</span>
                <b>{eth(calculatedPrice)} test ETH</b>
                <small>Asset value ÷ total tokens</small>
              </div>
              <button disabled={busy} className="primary full">
                {busy ? "Waiting for transaction…" : "Create asset →"}
              </button>
            </form>

            <div className="asset-list">
              <div className="list-heading">
                <h3>Existing assets</h3>
                <span>{assets.length} total</span>
              </div>
              {assets.length ? (
                assets.map((a) => (
                  <div className="asset-row" key={a.id}>
                    <div className="asset-icon">{a.name[0]}</div>
                    <div>
                      <b>{a.name}</b>
                      <small>
                        #{a.id} · {a.assetType}
                      </small>
                    </div>
                    {status(a.id)}
                  </div>
                ))
              ) : (
                <Empty
                  title="No assets loaded"
                  text="Connect MetaMask and refresh to load assets from the contract."
                />
              )}
            </div>
          </div>
        </section>
      )}

      {view === "investor" && (
        <section className="dashboard">
          <Heading
            tag="INVESTOR AREA"
            title="Explore verified assets"
            text="Choose an asset and purchase whole tokens using testnet ETH."
            action={() => void refresh()}
          />
          <div className="portfolio">
            <div>
              <span>Your token ownership</span>
              <strong>
                {Object.values(balances).reduce((a, b) => a + b, 0)} tokens
              </strong>
            </div>
            <div>
              <span>Total invested</span>
              <strong>{eth(total)} ETH</strong>
            </div>
            <div>
              <span>Connected wallet</span>
              <strong>{account ? short(account) : "Not connected"}</strong>
            </div>
          </div>

          {assets.filter((a) => verified.includes(a.id)).length ? (
            <div className="investment-grid">
              {assets
                .filter((a) => verified.includes(a.id))
                .map((a) => {
                  const n = amounts[a.id] || "";
                  const cost =
                    n && Number(n) > 0
                      ? a.tokenPrice * BigInt(Math.floor(Number(n)))
                      : BigInt(0);

                  return (
                    <article className="investment-card" key={a.id}>
                      <div className="card-top">
                        <span className="asset-number">ASSET #{a.id}</span>
                        {status(a.id)}
                      </div>
                      <h3>{a.name}</h3>
                      <p>
                        {a.assetType} · Value {eth(BigInt(a.value))} ETH
                      </p>
                      <div className="metric">
                        <span>Price per token</span>
                        <b>{eth(a.tokenPrice)} ETH</b>
                      </div>
                      <div className="metric">
                        <span>Available</span>
                        <b>{a.available.toLocaleString()} tokens</b>
                      </div>
                      <label className="buy-input">
                        Tokens to buy
                        <input
                          value={n}
                          onChange={(e) =>
                            setAmounts({ ...amounts, [a.id]: e.target.value })
                          }
                          type="number"
                          min="1"
                          max={a.available}
                          placeholder="0"
                        />
                      </label>
                      <div className="purchase-total">
                        <span>Total</span>
                        <b>{eth(cost)} ETH</b>
                      </div>
                      <button
                        disabled={busy}
                        className="primary full"
                        onClick={() => void buy(a)}
                      >
                        Invest / Buy tokens →
                      </button>
                      <small className="owned">
                        You own <b>{balances[a.id] || 0}</b> tokens
                      </small>
                    </article>
                  );
                })}
            </div>
          ) : (
            <Empty
              title="No verified assets yet"
              text="Create an asset first, then use the verification page to mark it verified for this prototype."
            />
          )}
        </section>
      )}

      {view === "verify" && (
        <section className="dashboard verification">
          <Heading
            tag="PUBLIC VERIFICATION"
            title="Check an asset"
            text="Anyone can look up the on-chain details using an Asset ID."
          />
          <div className="verify-search">
            <input
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              type="number"
              min="1"
              placeholder="Enter Asset ID, e.g. 1"
            />
            <button
              className="primary"
              onClick={() =>
                assetId
                  ? void refresh()
                  : setNotice("Enter an Asset ID first.")
              }
            >
              Find asset
            </button>
          </div>

          {selected ? (
            <div className="verify-card">
              <div className="verify-title">
                <div>
                  <span className="asset-number">ASSET #{selected.id}</span>
                  <h3>{selected.name}</h3>
                  <p>{selected.assetType}</p>
                </div>
                {status(selected.id)}
              </div>
              <div className="details">
                <Detail
                  l="Asset value"
                  v={eth(BigInt(selected.value)) + " ETH"}
                />
                <Detail
                  l="Total tokens"
                  v={selected.totalTokens.toLocaleString()}
                />
                <Detail
                  l="Token price"
                  v={eth(selected.tokenPrice) + " ETH"}
                />
                <Detail
                  l="Available tokens"
                  v={selected.available.toLocaleString()}
                />
                <Detail l="Issuer address" v={selected.issuer} mono />
              </div>
              <div className="verification-actions">
                <div>
                  <b>Admin verification</b>
                  <p>
                    The supplied contract has no verification function, so this
                    button marks status only in the current browser demo.
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={verified.includes(selected.id)}
                  onClick={() => {
                    setVerified([...verified, selected.id]);
                    setNotice(
                      "Asset marked verified for this frontend demo. It is now visible to investors."
                    );
                  }}
                >
                  {verified.includes(selected.id) ? "Verified" : "Verify asset"}
                </button>
              </div>
            </div>
          ) : (
            <Empty
              title="Look up an asset"
              text="Enter the Asset ID created by an issuer to view its details and verification status."
            />
          )}
        </section>
      )}
    </main>
  );
}

function Heading({
  tag,
  title,
  text,
  action,
}: {
  tag: string;
  title: string;
  text: string;
  action?: () => void;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{tag}</span>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      {action && (
        <button className="secondary" onClick={action}>
          ↻ Refresh assets
        </button>
      )}
    </div>
  );
}

function Detail({
  l,
  v,
  mono = false,
}: {
  l: string;
  v: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span>{l}</span>
      <b className={mono ? "mono" : ""}>{v}</b>
    </div>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <span>◇</span>
      <b>{title}</b>
      <p>{text}</p>
    </div>
  );
}