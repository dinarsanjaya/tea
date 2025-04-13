require("dotenv").config();

// Memuat variabel lingkungan dari .env
const { ethers } = require("ethers");
const fs = require("fs");
const axios = require("axios");

// === Konfigurasi Dasar ===
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Log configuration status without revealing sensitive data
console.log("=== Configuration Check ===");
console.log("RPC_URL set:", !!RPC_URL);
console.log("PRIVATE_KEY set:", !!PRIVATE_KEY);
console.log("TOKEN_ADDRESS set:", !!TOKEN_ADDRESS);
console.log("TELEGRAM_BOT_TOKEN set:", !!TELEGRAM_BOT_TOKEN);
console.log("TELEGRAM_CHAT_ID set:", !!TELEGRAM_CHAT_ID);

if (!PRIVATE_KEY || !RPC_URL || !TOKEN_ADDRESS) {
    console.error("⚠️ ERROR: Pastikan file .env sudah dikonfigurasi dengan benar.");
    process.exit(1);
}

// === Konfigurasi Provider & Wallet ===
const provider = new ethers.JsonRpcProvider(RPC_URL, {
    chainId: 10218, // Chain ID untuk Tea Sepolia
    name: "tea-sepolia"
});
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const tokenContract = new ethers.Contract(TOKEN_ADDRESS, [
    "function transfer(address to, uint256 amount) public returns (bool)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address account) view returns (uint256)",
    "function name() view returns (string)",
    "function symbol() view returns (string)"
], wallet);

// === Fungsi Logging ke File ===
function getLogFilename() {
    const today = new Date().toISOString().split("T")[0];
    return `log-${today}.txt`;
}
const logStream = fs.createWriteStream(getLogFilename(), { flags: 'a' });

function logMessage(level, message) {
    const timestamp = new Date().toISOString();
    const fullMessage = `[${timestamp}] [${level}] ${message}\n`;
    logStream.write(fullMessage);
    console.log(fullMessage);
}

// Define basic log functions BEFORE setting up the sendTelegramMessage dependency
function logError(message) {
    const timestamp = new Date().toISOString();
    const fullMessage = `[${timestamp}] [ERROR] ${message}\n`;
    logStream.write(fullMessage);
    console.log(fullMessage);
    // Don't call sendTelegramMessage here yet
}

function logInfoBasic(message) {
    const timestamp = new Date().toISOString();
    const fullMessage = `[${timestamp}] [INFO] ${message}\n`;
    logStream.write(fullMessage);
    console.log(fullMessage);
    // Don't call sendTelegramMessage here yet
}

// === Fungsi Delay dengan Rentang Tertentu ===
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Tambahkan fungsi ini untuk membuat link TX Hash
function formatTxHashWithLink(txHash) {
    // URL block explorer untuk Tea Sepolia
    const explorerUrl = "https://sepolia.tea.xyz/tx/";
    return `[${txHash}](${explorerUrl}${txHash})`;
}

// === Enhanced Debug Function for Telegram Configuration ===
async function sendTelegramMessageDirect(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.log("Telegram notifications disabled: Bot token or Chat ID missing");
        return false;
    }
    
    try {
        console.log(`Sending Telegram message: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
        
        const response = await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, 
            {
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: "Markdown"
            },
            { 
                timeout: 15000,
                validateStatus: function (status) {
                    return true;  // Always resolve to get the actual error response
                }
            }
        );
        
        console.log(`Response status: ${response.status}`);
        
        if (response.data && response.data.ok) {
            console.log("✅ Telegram message sent successfully");
            return true;
        } else {
            console.error(`Telegram API error: ${JSON.stringify(response.data, null, 2)}`);
            
            if (response.data && response.data.description) {
                if (response.data.description.includes("Bad Request: can't parse entities")) {
                    // Handle Markdown parsing errors by retrying without formatting
                    console.log("Retrying without Markdown formatting...");
                    const plainResponse = await axios.post(
                        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, 
                        {
                            chat_id: TELEGRAM_CHAT_ID,
                            text: message.replace(/\*/g, '').replace(/_/g, '').replace(/\[|\]/g, '').replace(/\(|\)/g, ' ') // Remove Markdown formatting
                        },
                        { timeout: 15000 }
                    );
                    
                    if (plainResponse.data && plainResponse.data.ok) {
                        console.log("✅ Plain text message sent successfully");
                        return true;
                    }
                }
            }
            
            return false;
        }
    } catch (err) {
        console.error("Telegram API call error:", err.message);
        
        if (err.response) {
            console.error(`Response status: ${err.response.status}`);
            console.error(`Response data: ${JSON.stringify(err.response.data, null, 2)}`);
        }
        
        if (err.code) {
            console.error(`Error code: ${err.code}`);
        }
        
        return false;
    }
}

// === Improved Telegram Notification Function with Detailed Error Logging ===
async function sendTelegramMessage(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.log("Telegram notifications disabled: Bot token or Chat ID missing");
        return;
    }
    
    // Try up to 3 times with exponential backoff
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            // Try to send with more specific error handling
            const success = await sendTelegramMessageDirect(message);
            if (success) return;
            
            // If direct send function returns false but doesn't throw, we still need to retry
            console.log(`Attempt ${attempt} failed without exception, retrying...`);
        } catch (err) {
            console.error(`Telegram notification attempt ${attempt} failed:`, err.message);
        }
        
        // Retry logic
        if (attempt < 3) {
            const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s
            console.log(`Retrying in ${waitTime/1000} seconds... (Attempt ${attempt + 1}/3)`);
            await delay(waitTime);
        } else {
            // All attempts failed - log to file so we have a record
            console.error("Failed to send Telegram notification after 3 attempts");
        }
    }
}

// Now we can define the real log functions that use sendTelegramMessage
function logInfo(message) {
    logInfoBasic(message);
    if (/Transaksi/.test(message)) {
        sendTelegramMessage(message).catch(err => {
            console.error("Error in Telegram notification during logInfo:", err.message);
        });
    }
}

// === Verification Function for Telegram Configuration ===
async function verifyTelegramConfig() {
    console.log("=== Beginning Telegram Configuration Verification ===");

    // Check if environment variables are set
    if (!TELEGRAM_BOT_TOKEN) {
        logInfoBasic("TELEGRAM_BOT_TOKEN is missing in .env file");
        return false;
    }
    
    if (!TELEGRAM_CHAT_ID) {
        logInfoBasic("TELEGRAM_CHAT_ID is missing in .env file");
        return false;
    }
    
    console.log("Environment variables present, testing API connection...");
    
    try {
        // Log partial token for debugging (security)
        let tokenPreview = "XXXXX";
        if (TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN.length > 10) {
            tokenPreview = TELEGRAM_BOT_TOKEN.substring(0, 5) + "..." + 
                          TELEGRAM_BOT_TOKEN.substring(TELEGRAM_BOT_TOKEN.length - 5);
        }
        console.log(`Using bot token: ${tokenPreview}`);
        console.log(`Using chat ID: ${TELEGRAM_CHAT_ID}`);
        
        // Try to send a test message directly using the direct function
        const success = await sendTelegramMessageDirect("✅ Bot verification message - System starting");
        
        if (success) {
            logInfoBasic("✅ Telegram bot configuration verified successfully!");
            return true;
        } else {
            logInfoBasic("❌ Telegram configuration verification failed - check logs for details");
            return false;
        }
    } catch (err) {
        logInfoBasic(`❌ Telegram configuration verification failed: ${err.message}`);
        console.error("Detailed error:", err);
        
        // Provide troubleshooting tips based on error type
        if (err.code === "ENOTFOUND") {
            console.log("\nTROUBLESHOOTING TIP: Could not reach Telegram API servers.");
            console.log("- Check your internet connection");
            console.log("- Verify that api.telegram.org is not blocked by your network/firewall");
        } else if (err.response && err.response.status === 401) {
            console.log("\nTROUBLESHOOTING TIP: Bot token is invalid.");
            console.log("- Verify your token with @BotFather on Telegram");
            console.log("- Make sure you copied the full token correctly");
        } else if (err.response && err.response.status === 400) {
            console.log("\nTROUBLESHOOTING TIP: Bad request - possibly invalid chat ID.");
            console.log("- Verify your chat ID with @userinfobot on Telegram");
            console.log("- Ensure you've started a chat with your bot");
            console.log("- For group chats, make sure the bot is a member of the group");
        }
        
        return false;
    }
}

// === Fungsi untuk Membaca & Menulis Alamat ===
function readAddressesFromFile(filename) {
    if (!fs.existsSync(filename)) return [];
    return fs.readFileSync(filename, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');
}

function writeAddressesToFile(filename, addresses) {
    fs.writeFileSync(filename, addresses.join('\n'), 'utf8');
}

// === Fungsi Fetch Data KYC ===
async function fetchKYCAddresses() {
    try {
        logInfoBasic("Mengunduh daftar alamat KYC...");
        const response = await axios.get("https://raw.githubusercontent.com/clwkevin/LayerOS/main/addressteasepoliakyc.txt");
        return response.data.split('\n').map(addr => addr.trim().toLowerCase());
    } catch (error) {
        logInfoBasic("Gagal mengunduh daftar KYC: " + error.message);
        return [];
    }
}

// === Fungsi Distribusi Token dengan TX Hash Link ===
async function distributeTokens() {
    try {
        // Check network connection before starting
        await provider.getNetwork().catch(err => {
            throw new Error(`Tidak dapat terhubung ke jaringan: ${err.message}`);
        });
        
        // Get token info
        const decimals = await tokenContract.decimals();
        let tokenName = "Unknown Token";
        let tokenSymbol = "";
        
        try {
            tokenName = await tokenContract.name();
            tokenSymbol = await tokenContract.symbol();
            logInfoBasic(`✅ Token terdeteksi: ${tokenName} (${tokenSymbol})`);
            await sendTelegramMessage(`✅ Token terdeteksi: *${tokenName}* (${tokenSymbol})`);
        } catch (error) {
            logInfoBasic(`⚠️ Tidak dapat membaca nama token: ${error.message}`);
        }
        
        // Check wallet balance
        const balance = await provider.getBalance(wallet.address);
        const tokenBalance = await tokenContract.balanceOf(wallet.address);
        
        logInfoBasic(`Saldo TEA: ${ethers.formatEther(balance)} TEA`);
        logInfoBasic(`Saldo ${tokenSymbol || "Token"}: ${ethers.formatUnits(tokenBalance, decimals)} ${tokenSymbol}`);
        
        await sendTelegramMessage(
            `📊 *Status Saldo Wallet*\n` +
            `• Saldo TEA: \`${ethers.formatEther(balance)}\` TEA\n` + 
            `• Saldo ${tokenSymbol || "Token"}: \`${ethers.formatUnits(tokenBalance, decimals)}\` ${tokenSymbol}`
        );
        
        // Ensure we have enough balance
        if (balance < ethers.parseEther("0.01")) {
            const lowBalanceMsg = "⚠️ Saldo TEA terlalu rendah untuk transaksi gas";
            logInfoBasic(lowBalanceMsg);
            await sendTelegramMessage(lowBalanceMsg);
            return;
        }
        
        // Amount to send: 1000 tokens per address with decimal adjustment
        const amountToSendPerAddress = ethers.parseUnits("1000.0", decimals);
        
        if (tokenBalance < amountToSendPerAddress) {
            const lowTokenMsg = `⚠️ Saldo ${tokenSymbol || "Token"} tidak cukup untuk distribusi`;
            logInfoBasic(lowTokenMsg);
            await sendTelegramMessage(lowTokenMsg);
            return;
        }
        
        let kycAddresses = await fetchKYCAddresses();
        if (kycAddresses.length === 0) {
            const noKycMsg = "⚠️ Tidak ada alamat KYC yang ditemukan.";
            logInfoBasic(noKycMsg);
            await sendTelegramMessage(noKycMsg);
            return;
        }

        let sentRecipients = readAddressesFromFile('kyc_addresses_sent.txt').map(addr => addr.toLowerCase());
        let failedRecipientsPrev = readAddressesFromFile('kyc_addresses_pending.txt').map(addr => addr.toLowerCase());

        // Gabungkan failed recipients sebelumnya
        let recipients = kycAddresses.filter(addr =>
            !sentRecipients.includes(addr) || failedRecipientsPrev.includes(addr)
        );

        // Kosongkan file pending untuk persiapan update baru
        writeAddressesToFile('kyc_addresses_pending.txt', []);

        if (recipients.length === 0) {
            const allSentMsg = "✓ Semua alamat KYC sudah menerima token.";
            logInfoBasic(allSentMsg);
            await sendTelegramMessage(allSentMsg);
            return;
        }

        const pendingAddressesMsg = `🔍 Ada ${recipients.length} alamat yang belum menerima token.`;
        logInfoBasic(pendingAddressesMsg);
        await sendTelegramMessage(pendingAddressesMsg);

        // Calculate max transactions based on token balance
        const maxPossibleTx = Math.floor(ethers.formatUnits(tokenBalance, decimals) / 1000);
        let transactionLimit = Math.min(
            recipients.length, 
            maxPossibleTx,
            Math.floor(Math.random() * (110 - 101 + 1) + 101)
        );
        
        const planMsg = `📊 Akan mengirim ${transactionLimit} transaksi (${transactionLimit * 1000} ${tokenSymbol}) hari ini.`;
        logInfoBasic(planMsg);
        await sendTelegramMessage(planMsg);

        let failedRecipients = [];
        let selectedRecipients = recipients.slice(0, transactionLimit).sort(() => 0.5 - Math.random());

        for (let i = 0; i < selectedRecipients.length; i++) {
            const recipient = selectedRecipients[i];

            // Tentukan delay sebelum transaksi
            const delayMs = Math.floor(Math.random() * (5 * 60 * 1000 - 2 * 60 * 1000) + 1 * 60 * 1000);
            const waitMsg = `⏱ Menunggu ${Math.floor(delayMs / 1000)} detik sebelum mengirim ke ${recipient}...`;
            logInfoBasic(waitMsg);
            // Tidak perlu spam Telegram dengan pesan menunggu

            await delay(delayMs);  // ⚠️ Pastikan transaksi benar-benar menunggu

            try {
                const sendingMsg = `🔄 Mengirim 1000 ${tokenSymbol} ke ${recipient}...`;
                logInfoBasic(sendingMsg);
                // Tidak perlu spam Telegram dengan pesan mengirim

                const tx = await tokenContract.transfer(recipient, amountToSendPerAddress);
                const receipt = await tx.wait(3); // tunggu 3 block konfirmasi
                
                // Format untuk file log (tanpa link)
                logInfoBasic(`✅ ${i + 1}. Transaksi Berhasil (${recipient}) - 1000 ${tokenSymbol} - TX Hash: ${tx.hash}`);
                
                // Format untuk Telegram (dengan link)
                const txHashLink = formatTxHashWithLink(tx.hash);
                await sendTelegramMessage(`✅ ${i + 1}. Transaksi Berhasil\n• Penerima: \`${recipient}\`\n• Jumlah: 1000 ${tokenSymbol}\n• TX Hash: ${txHashLink}`);

                sentRecipients.push(recipient);
                sentRecipients = [...new Set(sentRecipients)];
                writeAddressesToFile('kyc_addresses_sent.txt', sentRecipients);

                // Tambahkan delay setelah transaksi
                const postTxDelay = Math.floor(Math.random() * (70 * 1000 - 20 * 1000) + 30 * 1000); // 30–90 detik
                await delay(postTxDelay);
            } catch (error) {
                const errorMsg = `❌ ${i + 1}. Transaksi Gagal (${recipient}) - ${error.message}`;
                logInfoBasic(errorMsg);
                await sendTelegramMessage(errorMsg);
                failedRecipients.push(recipient);
            }
        }

        // Simpan ulang daftar gagal (untuk dicoba lagi besok)
        writeAddressesToFile('kyc_addresses_pending.txt', failedRecipients);

        const summaryMsg = `✓ Transaksi hari ini selesai. Berhasil: ${transactionLimit - failedRecipients.length}, Gagal: ${failedRecipients.length}`;
        logInfoBasic(summaryMsg);
        await sendTelegramMessage(summaryMsg);
    } catch (error) {
        const errorMsg = error.message;
        logInfoBasic(errorMsg);
        await sendTelegramMessage(`❌ Error: ${errorMsg}`);
    }
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
    logInfoBasic("Proses dihentikan oleh pengguna. Melakukan pembersihan...");
    // Close any open resources
    logStream.end();
    // Wait briefly to ensure logs are written
    await delay(1000);
    process.exit(0);
});

// === Loop Harian Otomatis ===
async function startDailyLoop() {
    // Verify Telegram config at startup
    const telegramConfigValid = await verifyTelegramConfig();
    
    if (!telegramConfigValid) {
        console.log("\n⚠️ PERINGATAN: Konfigurasi Telegram tidak valid!");
        console.log("Script akan tetap berjalan, tetapi notifikasi Telegram tidak akan dikirim.");
        console.log("Periksa file .env dan koneksi internet Anda.\n");
        
        // Continue running even if Telegram verification fails
    }
    
    while (true) {
        await distributeTokens();

        let now = new Date();
        let tomorrow = new Date();
        tomorrow.setUTCHours(0, 0, 0, 0);
        tomorrow.setDate(now.getUTCDate() + 1);

        let waitTime = tomorrow - now;
        const endMsg = `⏳ Selesai untuk hari ini. Menunggu hingga ${tomorrow.toISOString()}...\n`;
        logInfoBasic(endMsg);
        
        if (telegramConfigValid) {
            try {
                await sendTelegramMessage("📅 Transaksi hari ini selesai. Menunggu hingga besok.");
            } catch (error) {
                logInfoBasic(`Gagal mengirim notifikasi akhir: ${error.message}`);
            }
        }

        await delay(waitTime + Math.floor(Math.random() * 3 * 60 * 1000)); // Tambahkan sedikit variasi
    }
}

// === Mulai Loop ===
startDailyLoop();
