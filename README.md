## PriorAutoBot-NTE for multiwallet by hutaba update 
-------
### Clone

```
git clone https://github.com/hutaba-dev/PriorAutoBot-NTE-multiwallets
cd PriorAutoBot-NTE
```
### Install dependencies
```
npm install blessed ethers figlet dotenv
```

### If error during parcing or type error
downgrade ethers V5
```
npm uninstall ethers
npm install ethers@5.7.2
```

### wallets.txt 
private keys per line
```
nano wallets.txt
```

### proxies.txt
proxies 
```
http://id:pass@ip:port
```

### Run
```
node index.js
```

### special thanks to NTE group

### NOTE

For single wallet, use .env and insert your private key.

Thie code check firstly whether wallets.txt exists or not, if no, load the private key from .env. 
If there is wallets.txt, no access on .env
