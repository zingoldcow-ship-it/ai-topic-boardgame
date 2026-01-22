
/*! QR Code generator library (JavaScript) - based on Project Nayuki (Public Domain) */
"use strict";
var qrcodegen = (function(){
  function QrCode(version, errCorLvl, dataCodewords, mask){
    this.version = version;
    this.errorCorrectionLevel = errCorLvl;
    this.mask = mask;
    var size = version * 4 + 17;
    this.size = size;
    this.modules = [];
    this.isFunction = [];
    for (var y=0;y<size;y++){
      this.modules.push(new Array(size).fill(false));
      this.isFunction.push(new Array(size).fill(false));
    }
    this.drawFunctionPatterns();
    var allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);
    if (mask == -1){
      var minPenalty = 1e9, bestMask = 0;
      for (var i=0;i<8;i++){
        this.applyMask(i);
        this.drawFormatBits(i);
        var p = this.getPenaltyScore();
        if (p < minPenalty){ minPenalty = p; bestMask = i; }
        this.applyMask(i);
      }
      mask = bestMask;
    }
    this.mask = mask;
    this.applyMask(mask);
    this.drawFormatBits(mask);
    this.drawVersion();
  }

  QrCode.Ecc = { LOW:{ordinal:0,formatBits:1}, MEDIUM:{ordinal:1,formatBits:0}, QUARTILE:{ordinal:2,formatBits:3}, HIGH:{ordinal:3,formatBits:2} };

  QrCode.encodeText = function(text, ecl){
    var segs = [QrSegment.makeBytes(utf8ToBytes(text))];
    return QrCode.encodeSegments(segs, ecl);
  };

  QrCode.encodeSegments = function(segs, ecl, minVersion, maxVersion, mask, boostEcl){
    if (minVersion === undefined) minVersion = 1;
    if (maxVersion === undefined) maxVersion = 40;
    if (mask === undefined) mask = -1;
    if (boostEcl === undefined) boostEcl = true;

    var dataUsedBits = QrSegment.getTotalBits(segs, minVersion);
    if (dataUsedBits === null) throw "Too long";
    var version, dataCapacityBits;
    for (version=minVersion; ; version++){
      dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
      var used = QrSegment.getTotalBits(segs, version);
      if (used !== null && used <= dataCapacityBits) break;
      if (version >= maxVersion) throw "Too long";
    }
    if (boostEcl){
      for (var newEcl of [QrCode.Ecc.MEDIUM, QrCode.Ecc.QUARTILE, QrCode.Ecc.HIGH]){
        if (newEcl.ordinal < ecl.ordinal) continue;
        if (QrSegment.getTotalBits(segs, version) <= QrCode.getNumDataCodewords(version, newEcl)*8) ecl = newEcl;
      }
    }
    var bb = new BitBuffer();
    for (var seg of segs){
      bb.appendBits(seg.mode.modeBits, 4);
      bb.appendBits(seg.numChars, seg.mode.numCharCountBits(version));
      bb.appendData(seg);
    }
    bb.appendBits(0, Math.min(4, dataCapacityBits - bb.bitLength()));
    bb.appendBits(0, (8 - bb.bitLength()%8)%8);
    for (var pad=0; bb.bitLength() < dataCapacityBits; pad ^= 0xEC ^ 0x11){
      bb.appendBits((pad ? 0x11 : 0xEC), 8);
    }
    var dataCodewords = [];
    while (dataCodewords.length * 8 < bb.bitLength()){
      dataCodewords.push(bb.getBytes()[dataCodewords.length]);
    }
    return new QrCode(version, ecl, dataCodewords, mask);
  };

  QrCode.getNumDataCodewords = function(ver, ecl){
    return QrCode.getNumRawDataModules(ver) / 8 - QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] * QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
  };

  QrCode.getNumRawDataModules = function(ver){
    var result = (16*ver + 128)*ver + 64;
    if (ver >= 2){
      var numAlign = Math.floor(ver/7) + 2;
      result -= (25*numAlign - 10)*numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  };

  QrCode.prototype.getModule = function(x,y){
    return 0<=x && x<this.size && 0<=y && y<this.size && this.modules[y][x];
  };

  QrCode.prototype.toSvgString = function(border){
    if (border === undefined) border = 4;
    var parts = [];
    var size = this.size + border*2;
    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+size+' '+size+'" shape-rendering="crispEdges">');
    parts.push('<rect width="100%" height="100%" fill="#fff"/>');
    parts.push('<path d="');
    for (var y=0;y<this.size;y++){
      for (var x=0;x<this.size;x++){
        if (this.modules[y][x]){
          parts.push('M'+(x+border)+' '+(y+border)+'h1v1h-1z');
        }
      }
    }
    parts.push('" fill="#000"/>');
    parts.push('</svg>');
    return parts.join('');
  };

  QrCode.prototype.drawFunctionPatterns = function(){
    for (var i=0;i<this.size;i++){
      this.setFunctionModule(6,i, i%2===0);
      this.setFunctionModule(i,6, i%2===0);
    }
    this.drawFinderPattern(3,3);
    this.drawFinderPattern(this.size-4,3);
    this.drawFinderPattern(3,this.size-4);
    this.drawSeparators();
    this.drawAlignmentPatterns();
    this.setFunctionModule(8, this.size-8, true);
  };

  QrCode.prototype.drawSeparators = function(){
    var s=this.size;
    for (var i=0;i<8;i++){
      this.setFunctionModule(7,i,false);
      this.setFunctionModule(i,7,false);
      this.setFunctionModule(s-8,i,false);
      this.setFunctionModule(s-8+i,7,false);
      this.setFunctionModule(7,s-8+i,false);
      this.setFunctionModule(i,s-8,false);
    }
  };

  QrCode.prototype.drawFinderPattern = function(x,y){
    for (var dy=-4; dy<=4; dy++){
      for (var dx=-4; dx<=4; dx++){
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        var xx=x+dx, yy=y+dy;
        if (0<=xx && xx<this.size && 0<=yy && yy<this.size){
          this.setFunctionModule(xx,yy, dist!==2 && dist!==4);
        }
      }
    }
  };

  QrCode.prototype.drawAlignmentPatterns = function(){
    var pos = QrCode.getAlignmentPatternPositions(this.version);
    var num = pos.length;
    for (var i=0;i<num;i++){
      for (var j=0;j<num;j++){
        if ((i===0 && j===0) || (i===0 && j===num-1) || (i===num-1 && j===0)) continue;
        this.drawAlignmentPattern(pos[i], pos[j]);
      }
    }
  };

  QrCode.prototype.drawAlignmentPattern = function(x,y){
    for (var dy=-2;dy<=2;dy++){
      for (var dx=-2;dx<=2;dx++){
        this.setFunctionModule(x+dx,y+dy, Math.max(Math.abs(dx),Math.abs(dy))!==1);
      }
    }
  };

  QrCode.getAlignmentPatternPositions = function(ver){
    if (ver===1) return [];
    var num = Math.floor(ver/7)+2;
    var step = (ver===32) ? 26 : Math.ceil((ver*4+17-13)/(num*2-2))*2;
    var res=[6];
    for (var i=0;i<num-2;i++) res.splice(1,0,(ver*4+17-7) - i*step);
    res.push(ver*4+17-7);
    return res;
  };

  QrCode.prototype.drawFormatBits = function(mask){
    var data = (this.errorCorrectionLevel.formatBits<<3) | mask;
    var rem = data;
    for (var i=0;i<10;i++) rem = (rem<<1) ^ ((rem>>>9)*0x537);
    var bits = ((data<<10)|rem) ^ 0x5412;
    for (var i=0;i<=5;i++) this.setFunctionModule(8,i, ((bits>>>i)&1)!==0);
    this.setFunctionModule(8,7, ((bits>>>6)&1)!==0);
    this.setFunctionModule(8,8, ((bits>>>7)&1)!==0);
    this.setFunctionModule(7,8, ((bits>>>8)&1)!==0);
    for (var i=9;i<15;i++) this.setFunctionModule(14-i,8, ((bits>>>i)&1)!==0);
    for (var i=0;i<8;i++) this.setFunctionModule(this.size-1-i,8, ((bits>>>i)&1)!==0);
    for (var i=8;i<15;i++) this.setFunctionModule(8,this.size-15+i, ((bits>>>i)&1)!==0);
    this.setFunctionModule(8,this.size-8, true);
  };

  QrCode.prototype.drawVersion = function(){
    if (this.version < 7) return;
    var rem = this.version;
    for (var i=0;i<12;i++) rem = (rem<<1) ^ ((rem>>>11)*0x1F25);
    var bits = (this.version<<12)|rem;
    for (var i=0;i<18;i++){
      var bit = ((bits>>>i)&1)!==0;
      var a = this.size-11 + (i%3);
      var b = Math.floor(i/3);
      this.setFunctionModule(a,b,bit);
      this.setFunctionModule(b,a,bit);
    }
  };

  QrCode.prototype.setFunctionModule = function(x,y,isBlack){
    this.modules[y][x]=isBlack;
    this.isFunction[y][x]=true;
  };

  QrCode.prototype.addEccAndInterleave = function(data){
    var ver=this.version, ecl=this.errorCorrectionLevel;
    var numBlocks = QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
    var blockEccLen = QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
    var rawCodewords = QrCode.getNumRawDataModules(ver)/8;
    var numShortBlocks = numBlocks - rawCodewords % numBlocks;
    var shortBlockLen = Math.floor(rawCodewords/numBlocks);
    var blocks=[];
    var rs = new ReedSolomonGenerator(blockEccLen);
    var k=0;
    for (var i=0;i<numBlocks;i++){
      var datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      var dat = data.slice(k, k+datLen);
      k += datLen;
      var ecc = rs.getRemainder(dat);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var result=[];
    for (var i=0;i<blocks[0].length;i++){
      for (var j=0;j<blocks.length;j++){
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(blocks[j][i]);
      }
    }
    return result;
  };

  QrCode.prototype.drawCodewords = function(data){
    var i=0;
    for (var right=this.size-1; right>=1; right-=2){
      if (right===6) right=5;
      for (var vert=0; vert<this.size; vert++){
        for (var j=0;j<2;j++){
          var x=right-j;
          var y=((right+1)&2)? (this.size-1-vert): vert;
          if (!this.isFunction[y][x] && i < data.length*8){
            this.modules[y][x] = ((data[Math.floor(i/8)] >>> (7 - (i%8))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  };

  QrCode.prototype.applyMask = function(mask){
    for (var y=0;y<this.size;y++){
      for (var x=0;x<this.size;x++){
        if (this.isFunction[y][x]) continue;
        var invert = false;
        switch(mask){
          case 0: invert = (x+y)%2===0; break;
          case 1: invert = y%2===0; break;
          case 2: invert = x%3===0; break;
          case 3: invert = (x+y)%3===0; break;
          case 4: invert = (Math.floor(y/2)+Math.floor(x/3))%2===0; break;
          case 5: invert = (x*y)%2 + (x*y)%3 ===0; break;
          case 6: invert = ((x*y)%2 + (x*y)%3)%2===0; break;
          case 7: invert = ((x+y)%2 + (x*y)%3)%2===0; break;
        }
        this.modules[y][x] = this.modules[y][x] ^ invert;
      }
    }
  };

  QrCode.prototype.getPenaltyScore = function(){
    var result=0, size=this.size, m=this.modules;
    // Adjacent modules in row having same color
    for (var y=0;y<size;y++){
      var runColor=m[y][0], runLen=1;
      for (var x=1;x<size;x++){
        if (m[y][x]===runColor){ runLen++; if (runLen===5) result+=3; else if (runLen>5) result++; }
        else { runColor=m[y][x]; runLen=1; }
      }
    }
    // Adjacent modules in column having same color
    for (var x=0;x<size;x++){
      var runColor=m[0][x], runLen=1;
      for (var y=1;y<size;y++){
        if (m[y][x]===runColor){ runLen++; if (runLen===5) result+=3; else if (runLen>5) result++; }
        else { runColor=m[y][x]; runLen=1; }
      }
    }
    // 2x2 blocks
    for (var y=0;y<size-1;y++){
      for (var x=0;x<size-1;x++){
        var c=m[y][x];
        if (c===m[y][x+1] && c===m[y+1][x] && c===m[y+1][x+1]) result+=3;
      }
    }
    // Finder-like patterns
    function finderPenalty(runHistory){
      var n = runHistory[1];
      var core = n>0 && runHistory[2]===n && runHistory[3]===n*3 && runHistory[4]===n && runHistory[5]===n;
      return core ? 40 : 0;
    }
    function addRun(runHistory, runLen){
      runHistory.shift();
      runHistory.push(runLen);
      return finderPenalty(runHistory);
    }
    for (var y=0;y<size;y++){
      var runHistory=[0,0,0,0,0,0,0];
      var runColor=false, runLen=0;
      for (var x=0;x<size;x++){
        if (m[y][x]===runColor){ runLen++; }
        else {
          result += addRun(runHistory, runLen);
          runColor=m[y][x]; runLen=1;
        }
      }
      result += addRun(runHistory, runLen);
      result += addRun(runHistory, size);
    }
    for (var x=0;x<size;x++){
      var runHistory=[0,0,0,0,0,0,0];
      var runColor=false, runLen=0;
      for (var y=0;y<size;y++){
        if (m[y][x]===runColor){ runLen++; }
        else {
          result += addRun(runHistory, runLen);
          runColor=m[y][x]; runLen=1;
        }
      }
      result += addRun(runHistory, runLen);
      result += addRun(runHistory, size);
    }
    // Balance of black and white
    var black=0;
    for (var y=0;y<size;y++) for (var x=0;x<size;x++) if (m[y][x]) black++;
    var total=size*size;
    var k = Math.abs(black*20 - total*10) / total;
    result += Math.floor(k)*10;
    return result;
  };

  // Tables from spec (index by [ecl][version])
  QrCode.ECC_CODEWORDS_PER_BLOCK = [
    // LOW
    [0,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    // MEDIUM
    [0,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
    // QUARTILE
    [0,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    // HIGH
    [0,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
  ];
  QrCode.NUM_ERROR_CORRECTION_BLOCKS = [
    [0,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
    [0,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
    [0,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
    [0,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81],
  ];

  function QrSegment(mode, numChars, bitData){
    this.mode=mode; this.numChars=numChars; this.bitData=bitData;
  }
  QrSegment.Mode = {
    BYTE: {modeBits:4, numCharCountBits: function(ver){ return ver<=9?8:16; }},
  };
  QrSegment.makeBytes = function(data){
    var bb = new BitBuffer();
    for (var b of data) bb.appendBits(b,8);
    return new QrSegment(QrSegment.Mode.BYTE, data.length, bb);
  };
  QrSegment.getTotalBits = function(segs, ver){
    var result=0;
    for (var seg of segs){
      var ccbits = seg.mode.numCharCountBits(ver);
      if (seg.numChars >= (1<<ccbits)) return null;
      result += 4 + ccbits + seg.bitData.bitLength();
    }
    return result;
  };

  function BitBuffer(){ this.data=[]; this.bitLen=0; }
  BitBuffer.prototype.bitLength=function(){ return this.bitLen; };
  BitBuffer.prototype.appendBits=function(val, len){
    if (len<0 || len>31 || (val>>>len)!==0) throw "Value out of range";
    for (var i=len-1;i>=0;i--){
      this.data.push(((val>>>i)&1)!==0);
    }
    this.bitLen += len;
  };
  BitBuffer.prototype.appendData=function(seg){
    for (var b of seg.bitData.data) this.data.push(b);
    this.bitLen += seg.bitData.bitLength();
  };
  BitBuffer.prototype.getBytes=function(){
    var bytes=[];
    for (var i=0;i<this.data.length;i+=8){
      var b=0;
      for (var j=0;j<8 && i+j<this.data.length;j++){
        b = (b<<1) | (this.data[i+j]?1:0);
      }
      b <<= Math.max(0, 8 - Math.min(8, this.data.length-i));
      bytes.push(b & 0xFF);
    }
    return bytes;
  };

  function ReedSolomonGenerator(degree){
    if (degree<1 || degree>255) throw "degree";
    this.degree=degree;
    this.coefficients=new Array(degree).fill(0);
    this.coefficients[degree-1]=1;
    var root=1;
    for (var i=0;i<degree;i++){
      for (var j=0;j<degree;j++){
        this.coefficients[j] = QrCode.multiply(this.coefficients[j], root);
        if (j+1<degree) this.coefficients[j] ^= this.coefficients[j+1];
      }
      root = QrCode.multiply(root, 0x02);
    }
  }
  ReedSolomonGenerator.prototype.getRemainder=function(data){
    var result=new Array(this.degree).fill(0);
    for (var b of data){
      var factor = b ^ result[0];
      result.shift(); result.push(0);
      for (var i=0;i<result.length;i++){
        result[i] ^= QrCode.multiply(this.coefficients[i], factor);
      }
    }
    return result;
  };

  QrCode.multiply=function(x,y){
    var z=0;
    for (var i=7;i>=0;i--){
      z = ((z<<1) ^ ((z>>>7)*0x11D)) & 0xFF;
      if (((y>>>i)&1)!==0) z ^= x;
    }
    return z;
  };

  function utf8ToBytes(str){
    var enc = new TextEncoder();
    return Array.from(enc.encode(str));
  }

  return { QrCode: QrCode };
})();
