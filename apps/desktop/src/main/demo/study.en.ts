/**
 * The English copy of STUDY's demo slice.
 *
 * `study.ts` seeds the same final-year Computer Science student in either
 * language: the Serbian literals that have always lived beside the seeder, or
 * these, chosen by `DemoContext.locale`. Keeping the English table in its own
 * module means the Serbian path is untouched — `--shots` and every existing
 * test read exactly the bytes they read before — while the English path carries
 * a whole scene rather than a half-translated one.
 *
 * The shapes here mirror the seeder's own private ones (subjects, exam scopes,
 * card decks and topics). Nothing about the SCHEDULE lives here: the exam
 * offsets, the review-history simulation and the study plans are the same logic
 * for both languages, shared in `study.ts`.
 */

/** The seven subjects the demo student studies. */
export type DemoSubjectKey = "nbp" | "ml" | "ds" | "pr" | "bis" | "si" | "rg";

/** The six subjects that carry a flashcard deck — Computer Graphics has none. */
export type DemoDeckKey = "nbp" | "ml" | "ds" | "pr" | "bis" | "si";

/**
 * Every exam the seeder writes. A subject can carry more than one — a
 * `kolokvijum` in the past and an `usmeni` still ahead — so the exam key is not
 * the subject key.
 */
export type DemoExamKey =
  | "nbp"
  | "mlPismeni"
  | "dsKolokvijum"
  | "pr"
  | "bis"
  | "si"
  | "rg"
  | "dsUsmeni"
  | "mlUsmeni"
  | "siUsmeni";

export interface DemoCardSeed {
  readonly front: string;
  readonly back: string;
}

export interface DemoCardSet {
  readonly basics: readonly DemoCardSeed[];
  readonly clozes: readonly string[];
  readonly problem: { readonly front: string; readonly steps: readonly string[] };
}

export interface DemoSubjectCopy {
  readonly name: string;
  readonly semester: string;
}

export interface DemoTopicSeed {
  readonly exam: DemoExamKey;
  readonly name: string;
  readonly confidence: number | null;
  readonly deck?: DemoDeckKey;
}

export interface DemoStudyCopy {
  readonly subjects: Readonly<Record<DemoSubjectKey, DemoSubjectCopy>>;
  readonly scopes: Readonly<Record<DemoExamKey, string>>;
  readonly cards: Readonly<Record<DemoDeckKey, DemoCardSet>>;
  readonly topics: readonly DemoTopicSeed[];
}

const NBP_BASICS: readonly DemoCardSeed[] = [
  { front: "What is a B-tree and why is it used for indexes?", back: "A balanced search tree with several children per node whose height grows logarithmically with the number of keys, which minimises the number of disk I/O operations during a lookup." },
  { front: "How does a B+-tree differ from an ordinary B-tree?", back: "All data is stored only in the leaves, which are linked together into a list; internal nodes hold only keys for routing, which speeds up range queries." },
  { front: "What does the ACID acronym guarantee?", back: "Atomicity, Consistency, Isolation, Durability — a transaction is all-or-nothing, preserves the validity of the database, does not interleave with other transactions, and its effects survive a system crash." },
  { front: "What is a non-repeatable read and which isolation level prevents it?", back: "When the same query in the same transaction returns a different value for the same row twice because another transaction modified it in the meantime; REPEATABLE READ and higher levels prevent it." },
  { front: "What is a phantom read?", back: "When a transaction repeats a query with a WHERE condition and receives new rows that another transaction inserted in the meantime; only the SERIALIZABLE isolation level prevents it." },
  { front: "Define the third normal form (3NF).", back: "A relation is in 3NF if it is in 2NF and no non-key attribute depends transitively on the primary key." },
  { front: "What is denormalisation and when is it used?", back: "The deliberate introduction of redundancy for faster reads (fewer JOINs), at the cost of more complex consistency maintenance — typically in OLAP/reporting systems." },
  { front: "What is the difference between a clustered and a non-clustered index?", back: "A clustered index determines the physical order of rows in the table, and a table has at most one; a non-clustered index is a separate structure that points to rows, and a table may have several." },
  { front: "What is EXPLAIN ANALYZE for?", back: "It actually executes the query and shows the real execution plan with measured times per step, unlike EXPLAIN, which only estimates the plan." },
  { front: "Explain the difference between OLTP and OLAP systems.", back: "OLTP optimises frequent short transactions over a small number of rows; OLAP optimises complex aggregation queries over large historical data sets." },
  { front: "What is MVCC?", back: "Multi-Version Concurrency Control — a technique in which the database keeps several versions of a row so that readers see a consistent snapshot of the data without blocking writers, and vice versa." },
  { front: "What is a deadlock between transactions and how is it resolved?", back: "A circular wait of two or more transactions for resources the other holds; the database detects it and aborts (rolls back) one transaction as the victim." },
  { front: "What is database partitioning (sharding) for?", back: "It splits a large table or database into smaller parts by key for horizontal scaling of reads, writes and storage across several servers." },
  { front: "What is a covering index?", back: "An index that contains every column the query needs, so the answer is produced from the index alone without an additional table read." },
  { front: "What is the difference between INNER JOIN and LEFT OUTER JOIN?", back: "INNER JOIN returns only the rows that match in both tables; LEFT OUTER JOIN returns all rows of the left table, with NULL values where there is no match." },
  { front: "What is a write-ahead log (WAL) for?", back: "Changes are written to the log before they are applied to the data; it enables recovery after a system crash and is the basis for replication." },
  { front: "What is a foreign key constraint?", back: "A constraint ensuring that a column value in one table must exist as a key in another table, preserving referential integrity." },
  { front: "What is a materialised view?", back: "The result of a query physically stored as a table for read speed, refreshed periodically or manually, unlike an ordinary view, which is recomputed every time." },
];

const NBP_CLOZES: readonly string[] = [
  "{{c1::MVCC}} lets readers see a consistent snapshot of the data without waiting on {{c2::writers}}.",
  "Database normalisation goes through the forms: {{c1::1NF}}, {{c2::2NF}}, {{c3::3NF}}, and optionally {{c4::BCNF}}.",
];

const NBP_PROBLEM = {
  front: "A query joining students and grades on student_id runs slowly because there is no index. In what order do you diagnose and fix the problem?",
  steps: [
    "Run EXPLAIN ANALYZE and check whether the database performs a sequential scan instead of an index scan.",
    "Check that the column type for the JOIN (student_id) matches exactly in both tables — an implicit type conversion prevents the index from being used.",
    "Add an index on grades.student_id.",
    "Run EXPLAIN ANALYZE again and compare the plan and execution time with the previous one.",
  ],
};

const ML_BASICS: readonly DemoCardSeed[] = [
  { front: "What is overfitting?", back: "A model fitted too closely to the training data, noise included, so it generalises poorly to new, unseen data." },
  { front: "How does regularisation (L1/L2) reduce overfitting?", back: "It adds a penalty on the size of the weights to the loss function; L1 (Lasso) pushes some weights to zero (feature selection), L2 (Ridge) shrinks them evenly." },
  { front: "What does the bias-variance trade-off describe?", back: "High bias (too much simplification) leads to underfitting; high variance (over-sensitivity to the training set) leads to overfitting — the goal is to find the balance that minimises total error." },
  { front: "What is k-fold cross-validation for?", back: "It splits the data into k parts, trains on k-1 and tests on the remaining one, rotating the test part k times — giving a more reliable estimate of model performance than a single train/test split." },
  { front: "What does gradient descent do?", back: "It iteratively updates the model's parameters in the direction opposite to the gradient of the loss function, with a step set by the learning rate, until it finds a (local) minimum." },
  { front: "Why is the learning rate important in gradient descent?", back: "Too large a learning rate can overshoot the minimum or diverge; too small slows convergence and can get stuck in a local minimum or plateau." },
  { front: "What is an activation function and why is it necessary in neural networks?", back: "A non-linear transformation of a neuron's output (e.g. ReLU, sigmoid); without it, stacking layers would remain equivalent to a single linear transformation, however deep the network." },
  { front: "What is backpropagation?", back: "An algorithm that propagates the error backwards through the network's layers using the chain rule of differentiation, computing the gradient of the loss function with respect to each weight." },
  { front: "What is a random forest?", back: "An ensemble of a large number of decision trees, each trained on a random subset of the data and features (bagging), whose predictions are averaged or voted on." },
  { front: "What is a confusion matrix for?", back: "It shows the number of correctly and incorrectly classified examples per class (TP, FP, TN, FN), the basis for metrics such as precision, recall and the F1 score." },
  { front: "What does the F1 score measure and why is it used instead of accuracy?", back: "The harmonic mean of precision and recall; it is more useful than accuracy with imbalanced classes, where a model that always predicts the majority class has high accuracy but is useless." },
  { front: "What is k-means clustering?", back: "An unsupervised algorithm that splits the data into k groups by minimising the sum of squared distances of points from the centre (centroid) of their cluster, iteratively updating the centres." },
  { front: "What is one-hot encoding?", back: "Representing a categorical variable as a binary vector in which exactly one component is 1 and the rest are 0 — it avoids the false ordering that ordinary integer encoding would introduce." },
  { front: "Why are features standardised (normalised) before training many models?", back: "Features on different scales can dominate the loss function or slow the convergence of gradient descent; standardisation (e.g. z-score) equalises their influence." },
  { front: "What is dropout in neural networks?", back: "A regularisation technique that randomly “switches off” part of the neurons in a layer during training, preventing the network from relying too heavily on narrow combinations of neurons." },
  { front: "What is transfer learning?", back: "Reusing a model trained on one (usually large) data set as the starting point for a related task, instead of training from scratch." },
  { front: "What is the difference between supervised and unsupervised learning?", back: "Supervised learning trains a model on labelled examples (input + correct output); unsupervised learning looks for structure (clusters, projections) in unlabelled data." },
  { front: "What does the cross-entropy loss function measure?", back: "The difference between the predicted probability distribution over classes and the true (single) class; the standard choice for classification tasks." },
];

const ML_CLOZES: readonly string[] = [
  "Bias-variance trade-off: high {{c1::bias}} leads to underfitting, while high {{c2::variance}} leads to overfitting.",
  "The three main categories of machine learning are {{c1::supervised}}, {{c2::unsupervised}} and {{c3::reinforcement}} learning.",
];

const ML_PROBLEM = {
  front: "A classification model has 99% accuracy on a set where 99% of the examples are negative. How do you assess whether the model is really good?",
  steps: [
    "Compute the confusion matrix and look at the number of TP, FP, TN and FN — not just the overall accuracy.",
    "Compute precision and recall for the positive (minority) class — 99% accuracy here may mean the model always predicts the negative class.",
    "Compare the F1 score with the baseline (a model that always predicts the majority class) — if F1 is close to the baseline, the model has learned nothing.",
    "If the problem is real, consider balancing the classes (oversampling/undersampling) or adjusting the decision threshold.",
  ],
};

const DS_BASICS: readonly DemoCardSeed[] = [
  { front: "What does the CAP theorem state?", back: "A distributed system under a network partition (Partition tolerance) must choose between Consistency and Availability — all three cannot be guaranteed at the same time." },
  { front: "What is the difference between consistency and availability in the context of the CAP theorem?", back: "Consistency means all nodes see the same (latest) data at every moment; availability means every request receives a response, even if it is not the latest data." },
  { front: "What is the Raft consensus algorithm for?", back: "It lets a set of nodes agree on a single sequence of operations (a replicated log) even with node failures, by electing a leader that coordinates replication." },
  { front: "What is the split-brain problem?", back: "When a network partition leads two subsets of nodes to independently believe they are the active leader/primary, which can lead to conflicting writes." },
  { front: "What does the Two-Phase Commit (2PC) protocol do?", back: "The coordinator first asks all participants whether they can commit (the prepare phase), and only once all confirm does it send them the command for the final commit (the commit phase) — ensuring atomicity across several nodes." },
  { front: "What is the main drawback of the 2PC protocol?", back: "It is blocking — if the coordinator fails after the prepare phase, participants can remain locked waiting for the decision until the coordinator recovers." },
  { front: "What is a vector clock?", back: "A structure that assigns each event a vector of counters per node, making it possible to determine whether two events are causally related or concurrent, without synchronised clocks." },
  { front: "What is consistent hashing?", back: "A technique for distributing data across nodes over a circular hash space, so that adding or removing a node disturbs only a small part of the distribution instead of every key." },
  { front: "What is eventual consistency?", back: "A model in which, once new writes stop, all replicas eventually converge to the same value — it allows temporary inconsistency for greater availability." },
  { front: "What is a quorum in a replicated system?", back: "The minimum number of nodes that must confirm an operation (read or write) for it to count as successful; typically W + R > N guarantees that a read sees the last write." },
  { front: "What is the difference between horizontal and vertical scaling?", back: "Horizontal scaling adds more machines (sharding, replication); vertical scaling increases the resources of one machine (CPU, RAM)." },
  { front: "What is an idempotent operation and why does it matter in distributed systems?", back: "An operation whose result stays the same no matter how many times it is executed; it matters because the network can deliver the same request more than once (retry), so re-execution must do no harm." },
  { front: "What is a message queue (e.g. Kafka, RabbitMQ) and what is it for in a distributed system?", back: "A broker that holds messages between producers and consumers, enabling asynchronous communication, decoupling of services, and resilience to temporary consumer failures." },
  { front: "What is leader election?", back: "The process by which a distributed system chooses one node to coordinate a particular activity (e.g. replication), usually with algorithms such as Raft or Paxos, and a mechanism for detecting leader failure." },
  { front: "What is the difference between synchronous and asynchronous replication?", back: "Synchronous replication waits for a replica's acknowledgement before confirming the write to the client (stronger consistency, higher latency); asynchronous confirms immediately and replicates in the background (lower latency, risk of data loss)." },
  { front: "What is the circuit breaker pattern in microservices?", back: "A pattern that monitors failed calls to another service and, after a failure threshold, temporarily stops further calls (fail fast) instead of waiting for a timeout, giving the service time to recover." },
  { front: "What is fan-out in distributed systems?", back: "Sending a single request or event to several services/nodes in parallel, whose responses are then aggregated or processed independently." },
  { front: "Why is precise clock synchronisation hard in distributed systems, and how is it worked around?", back: "Network delays are variable, so absolute time is not reliable for ordering events; instead, logical (Lamport) or vector clocks are used to record causality." },
];

const DS_CLOZES: readonly string[] = [
  "In replication, {{c1::synchronous}} replication waits for an acknowledgement before responding to the client, while {{c2::asynchronous}} responds immediately and replicates in the background.",
  "CAP theorem: under a network partition the system chooses between {{c1::consistency}} and {{c2::availability}}.",
];

const DS_PROBLEM = {
  front: "A payment service occasionally charges twice because the client repeats the request after a timeout. How do you solve this at the design level?",
  steps: [
    "Recognise that the cause is a lack of idempotency — the network or the client can send the same request more than once.",
    "Introduce a unique idempotency key that the client generates per transaction and sends with every attempt.",
    "On the server, store the result of the first processing under that key; subsequent requests with the same key return the stored result instead of charging again.",
    "Set a sensible TTL for keeping the keys so the store does not grow without bound.",
  ],
};

const PR_BASICS: readonly DemoCardSeed[] = [
  { front: "What are the main phases of a compiler?", back: "Lexical analysis, syntax analysis, semantic analysis, intermediate code generation, code optimisation and target code generation." },
  { front: "What does lexical analysis (the scanner) do?", back: "It splits the source text into tokens (lexical units) according to regular expressions, removes whitespace and comments, and reports lexical errors." },
  { front: "What is a finite automaton and what is it for in lexical analysis?", back: "A model that recognises regular languages; a lexical analyser is generated as a (deterministic) finite automaton that recognises token patterns." },
  { front: "What does syntax analysis (the parser) do?", back: "It checks whether the sequence of tokens matches the language's grammar and builds a parse tree or abstract syntax tree (AST)." },
  { front: "What is the difference between an LL and an LR parser?", back: "An LL parser builds the tree from the root towards the leaves, reading the input left to right with a leftmost derivation; an LR parser builds the tree from the leaves towards the root with a rightmost derivation in reverse, recognising a wider class of grammars." },
  { front: "What is left recursion in a grammar and why is it a problem for LL parsers?", back: "A rule of the form A → Aα; an LL parser would enter infinite recursion trying to expand it, so the grammar must be transformed to remove it before generating an LL parser." },
  { front: "What is a symbol table?", back: "A data structure that stores information about identifiers (name, type, scope, address) used during semantic analysis and code generation." },
  { front: "What is an abstract syntax tree (AST)?", back: "A hierarchical representation of a program's structure that omits syntactic details (e.g. parentheses, semicolons) while keeping only the semantically important structure." },
  { front: "What is semantic analysis for?", back: "It checks the rules a grammar cannot express — type correctness, variable scope, uniqueness of declarations — and fills in the symbol table." },
  { front: "What is an intermediate representation and why is it used?", back: "A representation of the program independent of both the source and the target language (e.g. triples, quadruples, SSA); it allows optimisations and support for several target platforms to be written once, independently." },
  { front: "What is SSA (Static Single Assignment) form?", back: "An intermediate representation in which every variable is assigned exactly once, with phi nodes for merging values from different branches of the control flow — it simplifies many optimisations." },
  { front: "Give an example of an optimisation performed on intermediate code.", back: "Dead code elimination (removing instructions whose result is never used), constant folding (evaluating constant expressions in advance), or common subexpression elimination." },
  { front: "What is register allocation?", back: "The code generation phase that maps the (potentially unlimited) temporary variables of the intermediate code onto a limited set of physical processor registers, spilling some to memory when necessary." },
  { front: "What is a context-free grammar?", back: "A formal grammar whose rules have the form A → α, where A is a single non-terminal — expressive enough for the syntax of most programming languages, and generated and recognised by parsers." },
  { front: "What is overload resolution in semantic analysis?", back: "The procedure by which the compiler, when several functions/operators share a name, chooses exactly one matching definition on the basis of the argument types." },
  { front: "What is a shift-reduce conflict in an LR parser?", back: "A situation in which the parser does not know whether to shift the next token onto the stack or reduce the current sequence to a non-terminal — a sign of ambiguity or of the parser being too weak for that grammar." },
  { front: "Why are parser generators such as yacc/bison or ANTLR used?", back: "They generate a parser automatically from a formal grammar specification, avoiding hand-written, error-prone parsing code." },
  { front: "What is just-in-time (JIT) compilation?", back: "Compiling (part of) a program to machine code during execution rather than ahead of time, often with profiling so that “hot” code can be optimised more aggressively." },
];

const PR_CLOZES: readonly string[] = [
  "Compiler phases in order: {{c1::lexical}} analysis, {{c2::syntax}} analysis, {{c3::semantic}} analysis, code generation.",
  "An LL parser builds the tree {{c1::from the root towards the leaves}}, while an LR parser builds the tree {{c2::from the leaves towards the root}}.",
];

const PR_PROBLEM = {
  front: "The grammar E → E + T | T has left recursion and an LL(1) parser falls into an infinite loop. How do you transform it?",
  steps: [
    "Recognise the form of the left recursion: E → E + T | T.",
    "Introduce a new non-terminal E' and rewrite the rule without left recursion: E → T E'.",
    "Define E' to capture the repetition: E' → + T E' | ε.",
    "Check that the derived grammar generates the same language as the original, only right-recursive.",
  ],
};

const BIS_BASICS: readonly DemoCardSeed[] = [
  { front: "What is the basic difference between symmetric and asymmetric cryptography?", back: "Symmetric uses the same key for encryption and decryption (faster, key-distribution problem); asymmetric uses a public/private key pair (slower, solves key distribution and enables digital signatures)." },
  { front: "What is a hash function and which property makes it cryptographically secure?", back: "A function that maps an arbitrary input to a fixed-length output; a secure hash function is collision-resistant, cannot be inverted, and a small change in the input changes the whole output (the avalanche effect)." },
  { front: "What is a digital signature for?", back: "It proves the authenticity and integrity of a message — the sender encrypts the message hash with their private key, and the recipient verifies it with the sender's public key." },
  { front: "What happens during a TLS handshake (simplified)?", back: "The client and server agree on algorithms, the server sends its certificate (public key), they exchange (or derive via Diffie-Hellman) the material for a session key, and further communication is encrypted symmetrically with that key." },
  { front: "What is SQL injection?", back: "An attack in which unvalidated user input is inserted directly into a SQL query, changing its meaning — prevented by parameterised (bound) queries, never by string concatenation." },
  { front: "What is XSS (Cross-Site Scripting)?", back: "An attack in which the attacker injects malicious JavaScript into a page other users visit, because the application did not escape/sanitise user input before rendering it into HTML." },
  { front: "What is CSRF (Cross-Site Request Forgery)?", back: "An attack that makes an already signed-in user unknowingly send a request to an application they are authenticated with (e.g. by clicking a malicious link), abusing their session." },
  { front: "What is the principle of least privilege?", back: "Every user, process or system should be granted only the minimum rights necessary to perform its task, and nothing more." },
  { front: "What is the difference between authentication and authorisation?", back: "Authentication proves who you are (login, password, MFA); authorisation determines what you may do once authenticated (access rights, roles)." },
  { front: "What is RBAC (Role-Based Access Control)?", back: "An access control model in which rights are granted to roles rather than directly to users, and users are assigned to roles — it simplifies rights management across many users." },
  { front: "What is a salt when hashing passwords and why does it matter?", back: "A random value added to the password before hashing, unique per user; it prevents an attacker from using precomputed (rainbow) tables for all users at once." },
  { front: "Why are fast hash functions such as SHA-256 not used directly for hashing passwords?", back: "They are too fast, allowing an attacker billions of attempts per second; deliberately slow functions (bcrypt, scrypt, Argon2) are used to slow a brute-force attack." },
  { front: "What is a buffer overflow?", back: "Writing more data into a memory buffer than was allocated, overwriting adjacent data (e.g. the return address on the stack) and potentially enabling arbitrary code execution." },
  { front: "What is defence in depth?", back: "A security strategy with several independent layers of protection (network, application, data), so that breaching one layer does not compromise the whole system." },
  { front: "What does a firewall do and at which level does it typically filter traffic?", back: "It controls incoming and outgoing network traffic by rules (IP, port, protocol); it filters mainly at the network/transport layer, while more advanced ones (WAF) also understand the application layer." },
  { front: "What is a zero-day vulnerability?", back: "A security flaw discovered (and possibly actively exploited) before the software vendor has released a patch — “zero days” is the time the vendor had to react." },
  { front: "What is two-factor authentication (2FA/MFA)?", back: "Authentication that requires two or more independent factors (something you know, something you have, something you are), making account compromise harder even when the password has leaked." },
  { front: "What is a man-in-the-middle attack?", back: "An attacker inserts themselves between two communicating parties and intercepts or alters the traffic without either party noticing — authenticated encryption (e.g. TLS with certificate validation) protects against it." },
];

const BIS_CLOZES: readonly string[] = [
  "When hashing passwords, a {{c1::salt}} is added to prevent the use of precomputed {{c2::rainbow}} tables.",
  "The CIA triad in security: {{c1::Confidentiality}}, {{c2::Integrity}}, {{c3::Availability}}.",
];

const BIS_PROBLEM = {
  front: "A sign-in form concatenates user input directly into a SQL query (\"SELECT * FROM users WHERE username = '\" + input + \"'\"). How do you eliminate the problem systematically?",
  steps: [
    "Recognise the cause: concatenating untrusted input directly into a SQL string enables SQL injection.",
    "Replace the concatenation with a parameterised (bound) query using placeholders (?, $1) instead of manually joining strings.",
    "Add input length and type validation at the application level as an extra layer (defence in depth).",
    "Check whether the same pattern (concatenation into a SQL query) recurs elsewhere in the code, not only at the reported spot.",
  ],
};

const SI_BASICS: readonly DemoCardSeed[] = [
  { front: "What does the SOLID acronym mean in software design?", back: "Single responsibility, Open/closed, Liskov substitution, Interface segregation, Dependency inversion — five principles of object-oriented design that make code easier to maintain and extend." },
  { front: "Explain the Single Responsibility Principle.", back: "A class should have only one reason to change — one clearly defined responsibility; mixing several responsibilities into one class makes changes and testing harder." },
  { front: "What does the Open/Closed Principle state?", back: "Software entities should be open for extension but closed for modification — new functionality is added through new classes/implementations, not by changing existing, proven code." },
  { front: "What is the Liskov substitution principle?", back: "Objects of a derived class must be able to replace objects of the base class while the program remains correct — a subtype must not break the expectations (contract) imposed by its supertype." },
  { front: "What is the Singleton design pattern and what is the common criticism of it?", back: "A pattern that guarantees a class has exactly one instance with a global point of access; it is criticised for introducing global state and making testing and parallelisation harder." },
  { front: "What is the Factory Method design pattern?", back: "It defines an interface for creating an object but leaves it to subclasses to decide which concrete class to instantiate — separating object creation from the code that uses it." },
  { front: "What is the Observer design pattern?", back: "It defines a one-to-many dependency between objects, so that when the subject's state changes, all its observers are notified and updated automatically." },
  { front: "What is the Strategy design pattern?", back: "It encapsulates a family of algorithms behind a common interface and lets the algorithm be changed at run time independently of the client that uses it." },
  { front: "What is the difference between composition and inheritance?", back: "Inheritance establishes an is-a relationship and is statically bound to a type; composition establishes a has-a relationship by assembling objects and is more flexible because behaviour can change during execution." },
  { front: "What is the testing pyramid?", back: "A model recommending many unit tests at the base, fewer integration tests in the middle and the fewest end-to-end tests at the top, because unit tests are faster and cheaper to maintain." },
  { front: "What is the difference between a unit and an integration test?", back: "A unit test checks a single isolated component (usually with mocked dependencies); an integration test checks whether several components work together correctly, including real dependencies." },
  { front: "What is TDD (Test-Driven Development)?", back: "A practice in which you first write a (failing) test for the new behaviour, then the minimum code to make the test pass, then refactor the code — the red-green-refactor cycle." },
  { front: "What is code refactoring?", back: "Changing the internal structure of code for readability and maintainability without changing its external behaviour — it is safe only with test coverage that preserves that behaviour." },
  { front: "What is a code smell?", back: "A surface sign in code (e.g. an overly long method, duplicated code, an oversized class) that points to a deeper design problem, although it need not be a bug in itself." },
  { front: "What is continuous integration (CI)?", back: "The practice of frequently merging changes into a shared branch, with the build and tests run automatically on every merge, so that conflicts and regressions are found as early as possible." },
  { front: "What is Continuous Delivery?", back: "A practice in which every change that passes CI is automatically ready to be released to production at any moment, although the release itself may remain a manual decision." },
  { front: "What is technical debt?", back: "The implicit cost of future extra work caused by choosing a quick solution instead of a better approach that would have taken longer — like financial debt, it carries “interest” in the form of harder maintenance." },
  { front: "What is a Scrum sprint?", back: "A time-boxed period (usually 1-4 weeks) during which a team delivers a potentially usable product increment, with planning at the start and a retrospective at the end." },
];

const SI_CLOZES: readonly string[] = [
  "SOLID principles: {{c1::Single responsibility}}, {{c2::Open/closed}}, {{c3::Liskov substitution}}, {{c4::Interface segregation}}, {{c5::Dependency inversion}}.",
  "TDD cycle: {{c1::red}} (failing test), {{c2::green}} (test passes), {{c3::refactor}}.",
];

const SI_PROBLEM = {
  front: "A new feature requires one more if branch in an already enormous method that handles account types. How do you do it in the spirit of the Open/Closed principle?",
  steps: [
    "Recognise that adding another if/else branch violates the Open/Closed principle — every new account type requires changing existing, proven code.",
    "Extract a common interface (e.g. AccountHandler) with a method each account type implements in its own way.",
    "Create one implementation of the interface for each existing branch of the if/else chain, moving the logic out of the method.",
    "Add the new account type as a new implementation of the interface, without a single change to existing classes or the calls that use them.",
  ],
};

export const STUDY_EN: DemoStudyCopy = {
  subjects: {
    nbp: { name: "Advanced Databases", semester: "Semester 8" },
    ml: { name: "Machine Learning", semester: "Semester 8" },
    ds: { name: "Distributed Systems", semester: "Semester 8" },
    pr: { name: "Compilers", semester: "Semester 7" },
    bis: { name: "Information Security", semester: "Semester 7" },
    si: { name: "Software Engineering", semester: "Semester 8" },
    rg: { name: "Computer Graphics", semester: "Semester 7" },
  },
  scopes: {
    nbp: "Relational model, normalisation, indexes (B-tree, B+-tree), transaction fundamentals.",
    mlPismeni: "Regression, decision trees, neural network fundamentals, evaluation metrics.",
    dsKolokvijum: "CAP theorem, replication, 2PC, basic consistency models.",
    pr: "Lexical and syntax analysis, grammars, LL/LR parsing.",
    bis: "Cryptography, TLS, common attacks (SQLi, XSS, CSRF), access control.",
    si: "SOLID principles, design patterns, testing, Scrum.",
    rg: "Transformations, rasterisation, lighting (Phong), texturing.",
    dsUsmeni: "Consensus algorithms, partitioning, vector clocks, distributed transactions.",
    mlUsmeni: "Regularisation, ensembles, transfer learning, unsupervised learning.",
    siUsmeni: "Architectural patterns, refactoring, estimation and planning.",
  },
  cards: {
    nbp: { basics: NBP_BASICS, clozes: NBP_CLOZES, problem: NBP_PROBLEM },
    ml: { basics: ML_BASICS, clozes: ML_CLOZES, problem: ML_PROBLEM },
    ds: { basics: DS_BASICS, clozes: DS_CLOZES, problem: DS_PROBLEM },
    pr: { basics: PR_BASICS, clozes: PR_CLOZES, problem: PR_PROBLEM },
    bis: { basics: BIS_BASICS, clozes: BIS_CLOZES, problem: BIS_PROBLEM },
    si: { basics: SI_BASICS, clozes: SI_CLOZES, problem: SI_PROBLEM },
  },
  topics: [
    { exam: "nbp", name: "Indexing and B-trees", confidence: 85 },
    { exam: "nbp", name: "Normalisation and schema decomposition", confidence: null, deck: "nbp" },
    { exam: "nbp", name: "Transactions and ACID", confidence: 90 },
    { exam: "nbp", name: "Query optimisation (EXPLAIN, execution plans)", confidence: 55 },
    { exam: "nbp", name: "Replication and partitioning", confidence: null },
    { exam: "nbp", name: "NoSQL data models", confidence: 70 },

    { exam: "mlUsmeni", name: "Linear and logistic regression", confidence: 80 },
    { exam: "mlUsmeni", name: "Decision trees and ensembles (random forest)", confidence: null, deck: "ml" },
    { exam: "mlUsmeni", name: "Neural networks and backpropagation", confidence: 45 },
    { exam: "mlUsmeni", name: "Regularisation and overfitting", confidence: null, deck: "ml" },
    { exam: "mlUsmeni", name: "Model evaluation (confusion matrix, F1)", confidence: 65 },
    { exam: "mlUsmeni", name: "Unsupervised learning (k-means, clustering)", confidence: null },
    { exam: "mlUsmeni", name: "Transfer learning and pretrained models", confidence: 30 },

    { exam: "dsUsmeni", name: "CAP theorem and consistency", confidence: 75 },
    { exam: "dsUsmeni", name: "Consensus algorithms (Raft, Paxos)", confidence: null, deck: "ds" },
    { exam: "dsUsmeni", name: "Two-phase commit and distributed transactions", confidence: 50 },
    { exam: "dsUsmeni", name: "Replication (synchronous/asynchronous)", confidence: null, deck: "ds" },
    { exam: "dsUsmeni", name: "Partitioning and consistent hashing", confidence: 60 },
    { exam: "dsUsmeni", name: "Vector clocks and causality", confidence: 25 },

    { exam: "pr", name: "Lexical analysis and finite automata", confidence: 88 },
    { exam: "pr", name: "LL and LR syntax analysis", confidence: null, deck: "pr" },
    { exam: "pr", name: "Symbol table and semantic analysis", confidence: 72 },
    { exam: "pr", name: "Intermediate code and SSA form", confidence: 60 },
    { exam: "pr", name: "Code optimisation", confidence: null },
    { exam: "pr", name: "Register allocation", confidence: 78 },

    { exam: "bis", name: "Symmetric and asymmetric cryptography", confidence: 82 },
    { exam: "bis", name: "TLS/SSL protocol", confidence: null, deck: "bis" },
    { exam: "bis", name: "SQL injection and XSS", confidence: 95 },
    { exam: "bis", name: "Access control (RBAC, ACL)", confidence: 68 },
    { exam: "bis", name: "Hash functions and password storage", confidence: null },
    { exam: "bis", name: "Network security (firewall, MITM)", confidence: 58 },

    { exam: "si", name: "SOLID principles", confidence: 90 },
    { exam: "si", name: "Design patterns (GoF)", confidence: null, deck: "si" },
    { exam: "si", name: "Testing and TDD", confidence: 77 },
    { exam: "si", name: "CI/CD", confidence: 63 },
    { exam: "si", name: "Agile methodologies (Scrum)", confidence: null },
    { exam: "si", name: "Refactoring and technical debt", confidence: 71 },

    { exam: "rg", name: "Rasterisation and z-buffer", confidence: 40 },
    { exam: "rg", name: "Transformations and matrices (model-view-projection)", confidence: null },
    { exam: "rg", name: "Lighting (Phong model)", confidence: 55 },
    { exam: "rg", name: "Texturing and mapping", confidence: null },
    { exam: "rg", name: "Curves and surfaces (Bezier, B-spline)", confidence: 20 },
  ],
};
