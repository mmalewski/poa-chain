const express = require('express'),
      expressWinston = require('express-winston'),
      app = express(),
      bodyParser = require('body-parser'),
      port = 3000,
      jsonParser = bodyParser.json(),
      Web3 = require('web3'),
      _web3 = new Web3(),
      utils = require('ethereumjs-util'),
      cnf = require('./config'),
      winston = require('winston'),
      requestUri = require('request'),
      tweetnaclUtil = require('tweetnacl-util'),
      logger = winston.createLogger({
        level: 'info',
        format: winston.format.json(),
        transports: [
          new winston.transports.Console({ colorize: true }),
          new winston.transports.File({ filename: 'logs/output.log' })
        ]
      });

expressWinston.requestWhitelist.push('body');

var nacl = {};

nacl.util = tweetnaclUtil;

app.listen(port, (err) => {
    if (err) {
        return console.log("something bad happened", err);
    } 

    logger.info("server is listening on " + port);
 });

app.use(jsonParser);

app.use(expressWinston.logger({
    transports: [
      new winston.transports.Console({json: true, colorize: true }),
      new winston.transports.File({ filename: 'logs/trace.log' })
    ],
}));

app.post("/faucet", (req, resp) => {
    let body = req.body;
    let _addr = body.address;
    let _signature = body.signature;
    let _providerUri = cnf.protocol + "://" + cnf.host + ":" + cnf.port;

    let defaultProvider = new _web3.providers.HttpProvider(_providerUri);
   
    _web3.setProvider(defaultProvider); 
  
    if(!_web3.isConnected()) {
    
        resp.status(503).send("[web3] Connection to " + _providerUri + " is lost");
        resp.end();

        return;    
    }

    if (!_addr || !_signature)
    {
        resp.status(503).send("address or _signature is empty");
        resp.end();

        return;     
    }
    
    let _recoveredAddress = getRecoveredAddress(_addr, JSON.parse(_web3.toUtf8(_signature)));

    if (_recoveredAddress === _addr)
    {          
        let balance = _web3.fromWei(_web3.eth.getBalance(_addr), "ether");
        
        if (balance.gte(5))
        {
            resp.status(403).send("balance recipient must be less than 5");
            resp.end();

            return;
        } 

        let balanceSender = _web3.fromWei(_web3.eth.getBalance(cnf.sender), "ether");
        
        if (balanceSender.lt(5))
        {
            resp.status(503).send("balance sender must be more than 5");
            resp.end();          
   
            return;
        } 
        
        let rawTx = {
            nonce: _web3.toHex(_web3.eth.getTransactionCount(cnf.sender)),
            from: cnf.sender,
            gasPrice: _web3.toHex(_web3.eth.estimateGas({from: cnf.sender, to: _addr, value: _web3.toWei(cnf.quota, "ether")})),
     //       gasLimit: _web3.toHex(_web3.eth.getBlock("latest").gasLimit),
            to: _addr, 
            value:  _web3.toHex(_web3.toWei(cnf.quota, "ether"))
        }

        var options = {
            uri: _providerUri,
            method: 'POST',
            json: {
                "method":"personal_sendTransaction",
                "params": [rawTx,cnf.senderUnlockPhrase],
                "id": 0,
                "jsonrpc": "2.0"
            }
        };

        _web3.eth.getTransactionReceiptMined = getTransactionReceiptMined;

        requestUri(options, function (error, responseUri, body) {

            if (!(!error && responseUri.statusCode == 200 && !body.error)) {

                resp.status(503).send("error request to " + _providerUri);
                resp.end();            

                return;
            }

            let _txHash = body.result;

            _web3.eth.getTransactionReceiptMined(_txHash, 300).then(result => {								
                resp.statusCode = 200;  // OK 
                resp.end(); 

                return;
            },
            error => {
                resp.statusCode = 503; // Server Error  
                resp.end();
                
                return;
            });              
        });              
    }
    else 
    {
        resp.status(401).send("signature is not verify");
    }   
});


function getRecoveredAddress(message, signature) {
    let v =  signature.v;
    let r = Buffer.from(nacl.util.decodeBase64(signature.r));
    let s = Buffer.from(nacl.util.decodeBase64(signature.s));
    
    var pub = utils.ecrecover(utils.sha3(message), v, r, s);

    var recoveredAddress = '0x' + utils.pubToAddress(pub).toString('hex')

    return recoveredAddress;
}

function getTransactionReceiptMined(txHash, interval) {
    const self = this;
    const transactionReceiptAsync = function(resolve, reject) {
        self.getTransactionReceipt(txHash, (error, receipt) => {
            if (error) {
                reject(error);
            } else if (receipt == null || receipt.blockHash == null) {
                setTimeout(
                    () => transactionReceiptAsync(resolve, reject),
                    interval ? interval : 500);
            } else {
                resolve(receipt);
            }
        });
    };

    if (Array.isArray(txHash)) {
        return Promise.all(txHash.map(
            oneTxHash => self.getTransactionReceiptMined(oneTxHash, interval)));
    } else if (typeof txHash === "string") {
        return new Promise(transactionReceiptAsync);
    } else {
        throw new Error("Invalid Type: " + txHash);
    }
}
