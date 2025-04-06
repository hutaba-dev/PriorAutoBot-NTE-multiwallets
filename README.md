## PriorAutoBot-NTE by hutaba update for multiwallet
-------
### Clone

```
git clone https://github.com/hutaba-dev/PriorAutoBot-NTE-multiwallets
cd PriorAutoBot-NTE
```
### Isntall dependencies
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

### run
```
node index.js
```

### special thanks to NTE group
