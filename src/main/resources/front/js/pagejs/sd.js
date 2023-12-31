        var begin = document.getElementById('intercomBegin');
        var end = document.getElementById('intercomEnd');
		
        var ws = null; //实现WebSocket 
        var record = null; //多媒体对象，用来处理音频
 
        function init(rec) {
            record = rec;
        }

        //录音对象
        var Recorder = function(stream) {
            var sampleBits = 16; //输出采样数位 8, 16
            var sampleRate = 16000; //输出采样率
            var context = new AudioContext();
            var audioInput = context.createMediaStreamSource(stream);
            var recorder = context.createScriptProcessor(4096, 1, 1);
            var audioData = {
                size: 0, //录音文件长度
                buffer: [], //录音缓存
                inputSampleRate: 48000, //输入采样率
                inputSampleBits: 16, //输入采样数位 8, 16
                outputSampleRate: sampleRate, //输出采样数位
                outputSampleBits: sampleBits, //输出采样率
                clear: function() {
                    this.buffer = [];
                    this.size = 0;
                },
                input: function(data) {
                    this.buffer.push(new Float32Array(data));
                    this.size += data.length;
                    console.log(this.buffer)
                },
                compress: function() { //合并压缩
                    //合并
                    var data = new Float32Array(this.size);
                    var offset = 0;
                    for (var i = 0; i < this.buffer.length; i++) {
                        console.log(offset)
                        data.set(this.buffer[i], offset);
                        offset += this.buffer[i].length;
                    }
                    //压缩
                    var compression = parseInt(this.inputSampleRate / this.outputSampleRate);
                    var length = data.length / compression;
                    var result = new Float32Array(length);
                    var index = 0,
                    j = 0;
                    while (index < length) {
                        result[index] = data[j];
                        j += compression;
                        index++;
                    }
                    return result;
                },
                encodePCM: function() { //这里不对采集到的数据进行其他格式处理，如有需要均交给服务器端处理。
                    var sampleRate = Math.min(this.inputSampleRate, this.outputSampleRate);
                    var sampleBits = Math.min(this.inputSampleBits, this.outputSampleBits);
                    var bytes = this.compress();
                    var dataLength = bytes.length * (sampleBits / 8);
                    console.log(dataLength)
                    var buffer = new ArrayBuffer(dataLength);
                    var data = new DataView(buffer);
                    var offset = 0;
                    for (var i = 0; i < bytes.length; i++, offset += 2) {
                    var s = Math.max(-1, Math.min(1, bytes[i]));
                        data.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                    }
                    return new Blob([data]);
                }
            };

            var sendData = function() { //对以获取的数据进行处理(分包)
                var reader = new FileReader();
                console.log(audioData.encodePCM())
                reader.onload = e => {
                    console.log(e)
                    var outbuffer = e.target.result;
                    var arr = new Int8Array(outbuffer);
                    if (arr.length > 0) {
                        var tmparr = new Int8Array(1024);
                        var j = 0;
                        for (var i = 0; i < arr.byteLength; i++) {
                            tmparr[j++] = arr[i];
                            if (((i + 1) % 1024) == 0) {
                                ws.send(tmparr);
                                if (arr.byteLength - i - 1 >= 1024) {
                                    tmparr = new Int8Array(1024);
                                } else {
                                    tmparr = new Int8Array(arr.byteLength - i - 1);
                                }
                                j = 0;
                            }
                            if ((i + 1 == arr.byteLength) && ((i + 1) % 1024) != 0) {
                                ws.send(tmparr);
                            }
                        }
                    }
                };
                reader.readAsArrayBuffer(audioData.encodePCM());
                audioData.clear();//每次发送完成则清理掉旧数据
            };

            this.start = function() {
                audioInput.connect(recorder);
                recorder.connect(context.destination);
            }

            this.stop = function() {
                recorder.disconnect();
            }
            this.getBlob = function() {
                return audioData.encodePCM();
            }

            this.clear = function() {
                audioData.clear();
            }
			this.onmessage= function(msg) {
                console.log(msg)
            }
            recorder.onaudioprocess = function(e) {
                var inputBuffer = e.inputBuffer.getChannelData(0);
                audioData.input(inputBuffer);
                sendData();
            }
        }

		
        /*
        * WebSocket
        */
        function useWebSocket() {
            let baseUrl = 'localhost'
            ws = new WebSocket("ws://"+ baseUrl +":8089");
            ws.binaryType = 'arraybuffer'; //传输的是 ArrayBuffer 类型的数据
            ws.onopen = function() {
                console.log('握手成功'+ws);
                if (ws.readyState == 1) { //ws进入连接状态，则每隔500毫秒发送一包数据
                    record.start();
                }
            ws.onmessage=function (event) {
                console.log('Message from server ', event);
            };
            };
        }
		
        /*
        * 开始对讲
        */
        begin.onclick = function() {
            navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia;
            if (!navigator.getUserMedia) {
                alert('浏览器不支持音频输入');
            } else {
                navigator.getUserMedia({
                audio: true
            },
            function(mediaStream) {
                init(new Recorder(mediaStream));
                console.log('开始对讲');
                useWebSocket();
            },
            function(error) {
                console.log(error);
                switch (error.message || error.name) {
                    case 'PERMISSION_DENIED':  
                    case 'PermissionDeniedError':  
                        console.info('用户拒绝提供信息。');  
                        break;  
                    case 'NOT_SUPPORTED_ERROR':  
                    case 'NotSupportedError':  
                        console.info('浏览器不支持硬件设备。');  
                        break;  
                    case 'MANDATORY_UNSATISFIED_ERROR':  
                    case 'MandatoryUnsatisfiedError':  
                        console.info('无法发现指定的硬件设备。');  
                        break;  
                        default:  
                        console.info('无法打开麦克风。异常信息:' + (error.code || error.name));  
                        break;  
                        }  
                    }
                )
            }
        }
 
        /*
        * 关闭对讲
        */
        end.onclick = function() {
            if (ws) {
                record.stop();
                console.log('关闭对讲以及WebSocket');
                ws.close(1000)
            }
        }