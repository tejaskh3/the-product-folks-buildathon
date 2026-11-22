// Starter feed for a new persona topic: well-known, real sources (reading recommendations, not news),
// so the feed is useful before the research agent has run. The research agent adds live items on top.

export interface Sample {
  kind: "article" | "finding";
  title: string;
  body: string;
  url: string;
  arxiv_id: string | null;
}

const arxiv = (id: string, title: string, body: string, kind: Sample["kind"] = "article"): Sample => ({
  kind,
  title: `Worth reading: ${title}`,
  body,
  url: `https://arxiv.org/abs/${id}`,
  arxiv_id: id,
});

const BUCKETS: { match: RegExp; items: Sample[] }[] = [
  {
    match: /\b(ai|a\.i\.|llm|llms|ml|machine learning|deep learning|agents?|gpt|transformer|neural)\b/i,
    items: [
      arxiv("1706.03762", "Attention Is All You Need", "The 2017 paper that introduced the Transformer, the architecture behind today's large language models."),
      arxiv("2005.14165", "Language Models are Few-Shot Learners (GPT-3)", "Showed that scaling a language model lets it pick up new tasks from a handful of examples in the prompt."),
      arxiv("2201.11903", "Chain-of-Thought Prompting", "Asking a model to reason step by step markedly improves its answers on maths and logic problems.", "finding"),
      arxiv("2210.03629", "ReAct: Reasoning and Acting", "The pattern most AI agents use: interleave reasoning with tool calls such as search.", "finding"),
    ],
  },
  {
    match: /\b(crypto|bitcoin|btc|blockchain|ethereum|eth|web3|defi|stablecoins?)\b/i,
    items: [
      { kind: "article", title: "Worth reading: Bitcoin: A Peer-to-Peer Electronic Cash System", body: "Satoshi Nakamoto's 2008 whitepaper: proof-of-work and a public ledger let strangers agree on who owns what.", url: "https://bitcoin.org/bitcoin.pdf", arxiv_id: null },
      { kind: "article", title: "Worth reading: The Ethereum whitepaper", body: "Vitalik Buterin's design for a blockchain that runs programs (smart contracts), the base layer of DeFi.", url: "https://ethereum.org/en/whitepaper/", arxiv_id: null },
      { kind: "finding", title: "Worth knowing: Ethereum's move to proof-of-stake", body: "The Merge (2022) switched Ethereum from mining to staking and cut its energy use by about 99.95%.", url: "https://ethereum.org/en/roadmap/merge/", arxiv_id: null },
    ],
  },
  {
    match: /\b(bio|biotech|biology|crispr|gene|genomics|health|medicine|drug|protein)\b/i,
    items: [
      { kind: "article", title: "Worth reading: A programmable dual-RNA–guided DNA endonuclease", body: "Jinek, Doudna, Charpentier et al. (Science, 2012): the paper that turned CRISPR-Cas9 into a gene-editing tool.", url: "https://www.science.org/doi/10.1126/science.1225829", arxiv_id: null },
      { kind: "finding", title: "Worth knowing: AlphaFold predicts protein structures", body: "Jumper et al. (Nature, 2021): AI predicts a protein's 3D shape from its sequence, close to lab accuracy.", url: "https://www.nature.com/articles/s41586-021-03819-2", arxiv_id: null },
      { kind: "article", title: "Start here: latest quantitative biology on arXiv", body: "New preprints in quantitative biology, updated daily.", url: "https://arxiv.org/list/q-bio/new", arxiv_id: null },
    ],
  },
  {
    match: /\b(climate|energy|carbon|fusion|solar|battery|batteries|sustainability)\b/i,
    items: [
      { kind: "article", title: "Worth reading: IPCC Sixth Assessment Report, Synthesis", body: "The scientific consensus on warming, its impacts and the paths to limit it, in one report (2023).", url: "https://www.ipcc.ch/report/ar6/syr/", arxiv_id: null },
      { kind: "finding", title: "Worth knowing: fusion ignition at the National Ignition Facility", body: "In December 2022 a fusion experiment produced more energy than the lasers delivered to the target, a first.", url: "https://lasers.llnl.gov/science/achieving-fusion-ignition", arxiv_id: null },
      { kind: "article", title: "Start here: IEA World Energy Outlook", body: "The International Energy Agency's yearly view of where energy supply and demand are heading.", url: "https://www.iea.org/reports/world-energy-outlook-2024", arxiv_id: null },
    ],
  },
  {
    match: /\b(quantum|qubits?)\b/i,
    items: [
      { kind: "finding", title: "Worth knowing: quantum supremacy with a programmable processor", body: "Arute et al. (Nature, 2019): Google's Sycamore chip ran a sampling task far beyond what classical computers could do at the time.", url: "https://www.nature.com/articles/s41586-019-1666-5", arxiv_id: null },
      arxiv("quant-ph/9508027", "Shor's algorithm", "Why a large quantum computer could break today's public-key encryption by factoring large numbers quickly."),
      { kind: "article", title: "Start here: latest quantum physics on arXiv", body: "New preprints in quantum physics, updated daily.", url: "https://arxiv.org/list/quant-ph/new", arxiv_id: null },
    ],
  },
  {
    match: /\b(finance|fintech|markets?|investing|economics|trading|banking)\b/i,
    items: [
      { kind: "article", title: "Start here: latest quantitative finance on arXiv", body: "New preprints in quantitative finance, updated daily.", url: "https://arxiv.org/list/q-fin/new", arxiv_id: null },
      { kind: "article", title: "Worth reading: BIS Annual Economic Report", body: "The Bank for International Settlements' yearly view of the global financial system.", url: "https://www.bis.org/publ/arpdf/", arxiv_id: null },
      { kind: "finding", title: "Worth knowing: Fama–French factors", body: "Small-cap and value stocks have historically earned returns beyond what market risk alone explains. The data library is free.", url: "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html", arxiv_id: null },
    ],
  },
];

export function samplesFor(topic: string): Sample[] {
  const bucket = BUCKETS.find((b) => b.match.test(topic));
  if (bucket) return bucket.items;
  const q = encodeURIComponent(topic);
  return [
    { kind: "article", title: `Start here: newest arXiv papers on ${topic}`, body: "The most recent preprints matching your topic, newest first.", url: `https://arxiv.org/search/?query=${q}&searchtype=all&order=-announced_date_first`, arxiv_id: null },
    { kind: "article", title: `Start here: most-cited research on ${topic}`, body: "The papers everyone builds on, ranked by citations on Google Scholar.", url: `https://scholar.google.com/scholar?q=${q}`, arxiv_id: null },
    { kind: "finding", title: `Tip: tap "Refresh live" for what's new in ${topic}`, body: "The research agent searches the web now and adds the top new articles and findings to this feed.", url: `https://scholar.google.com/scholar?q=${q}&as_ylo=${new Date().getFullYear()}`, arxiv_id: null },
  ];
}
