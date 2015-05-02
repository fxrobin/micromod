
function IBXMReplay( module, samplingRate ) {
	/* Return a String representing the version of the replay. */
	this.getVersion = function() {
		return "20150502 (c)2015 mumart@gmail.com";
	}
	/* Return the sampling rate of playback. */
	this.getSamplingRate = function() {
		return samplingRate;
	}
	/* Set the sampling rate of playback. */
	this.setSamplingRate = function( rate ) {
		// Use with Module.c2Rate to adjust the tempo of playback.
		// To play at half speed, multiply both the samplingRate and Module.c2Rate by 2.
		if( rate < 8000 || rate > 128000 ) {
			throw "Unsupported sampling rate!";
		}
		samplingRate = rate;
	}
	/* Enable or disable the linear interpolation filter. */
	this.setInterpolation = function( interp ) {
		interpolation = interp;
	}
	/* Get the current row position. */
	this.getRow = function() {
		return row;
	}
	/* Get the current pattern position in the sequence. */
	this.getSequencePos = function() {
		return seqPos;
	}
	/* Set the pattern in the sequence to play.
	   The tempo is reset to the default. */
	this.setSequencePos = function( pos ) {
		if( pos >= module.sequenceLength ) {
			pos = 0;
		}
		breakSeqPos = pos;
		nextRow = 0;
		tick = 1;
		this.globalVol = module.defaultGVol;
		speed = module.defaultSpeed > 0 ? module.defaultSpeed : 6;
		tempo = module.defaultTempo > 0 ? module.defaultTempo : 125;
		plCount = plChannel = -1;
		for( var idx = 0; idx < module.numChannels; idx++ ) {
			channels[ idx ] = new IBXMChannel( this, idx );
		}
		for( var idx = 0; idx < 128; idx++ ) {
			rampBuf[ idx ] = 0;
		}
		mixIdx = mixLen = 0;
		seqTick();
	}
	/* Returns the song duration in samples at the current sampling rate. */
	this.calculateSongDuration = function() {
		var duration = 0;
		this.setSequencePos( 0 );
		var songEnd = false;
		while( !songEnd ) {
			duration += calculateTickLen( tempo, samplingRate );
			songEnd = seqTick();
		}
		this.setSequencePos( 0 );
		return duration;
	}
	/* Seek to approximately the specified sample position.
	   The actual sample position reached is returned. */
	this.seek = function( samplePos ) {
		this.setSequencePos( 0 );
		var currentPos = 0;
		var tickLen = calculateTickLen( tempo, samplingRate );
		while( ( samplePos - currentPos ) >= tickLen ) {
			for( var idx = 0; idx < module.numChannels; idx++ ) {
				channels[ idx ].updateSampleIdx( tickLen * 2, samplingRate * 2 );
			}
			currentPos += tickLen;
			seqTick();
			tickLen = calculateTickLen( tempo, samplingRate );
		}
		return currentPos;
	}
	/* Seek to the specified position and row in the sequence. */
	this.seekSequencePos = function( sequencePos, sequenceRow ) {
		this.setSequencePos( 0 );
		if( sequencePos < 0 || sequencePos >= module.sequenceLength ) {
			sequencePos = 0;
		}
		if( sequenceRow >= module.patterns[ module.sequence[ sequencePos ] ].numRows ) {
			sequenceRow = 0;
		}
		while( seqPos < sequencePos || row < sequenceRow ) {
			var tickLen = calculateTickLen( tempo, sampleRate );
			for( var idx = 0; idx < module.numChannels; idx++ ) {
				channels[ idx ].updateSampleIdx( tickLen * 2, sampleRate * 2 );
			}
			if( seqTick() ) { // Song end reached.
				setSequencePos( sequencePos );
				return;
			}
		}
	}
	/* Write count floating-point stereo samples into outputBuf. */
	this.getAudio = function( outputBuf, count ) {
		var outIdx = 0;
		while( outIdx < count ) {
			if( mixIdx >= mixLen ) {
				mixLen = mixAudio( mixBuf );
				mixIdx = 0;
			}
			var remain = mixLen - mixIdx;
			if( ( outIdx + remain ) > count ) {
				remain = count - outIdx;
			}
			for( var idx = outIdx << 1, end = ( outIdx + remain ) << 1, mix = mixIdx << 1; idx < end; ) {
				// Convert to floating-point and divide by ~32768 for output.
				outputBuf[ idx++ ] = mixBuf[ mix++ ] * 0.0000305;
			}
			mixIdx += remain;
			outIdx += remain;
		}
	}
	var mixAudio = function( outputBuf ) {
		// Generate audio. The number of samples produced is returned.
		var tickLen = calculateTickLen( tempo, samplingRate );
		for( var idx = 0, end = ( tickLen + 65 ) * 4; idx < end; idx++ ) {
			// Clear mix buffer.
			mixBuf[ idx ] = 0;
		}
		for( var idx = 0; idx < module.numChannels; idx++ ) {
			// Resample and mix each channel.
			var chan = channels[ idx ];
			chan.resample( mixBuf, 0, ( tickLen + 65 ) * 2, samplingRate * 2, interpolation );
			chan.updateSampleIdx( tickLen * 2, samplingRate * 2 );
		}
		downsample( mixBuf, tickLen + 64 );
		volumeRamp( mixBuf, tickLen );
		// Update the sequencer.
		seqTick();
		return tickLen;
	}
	var calculateTickLen = function( tempo, sampleRate ) {
		return ( ( sampleRate * 5 ) / ( tempo * 2 ) ) | 0;
	}
	var volumeRamp = function( mixBuf, tickLen ) {
		var rampRate = ( 256 * 2048 / samplingRate ) | 0;
		for( var idx = 0, a1 = 0; a1 < 256; idx += 2, a1 += rampRate ) {
			var a2 = 256 - a1;
			mixBuf[ idx     ] = ( mixBuf[ idx     ] * a1 + rampBuf[ idx     ] * a2 ) >> 8;
			mixBuf[ idx + 1 ] = ( mixBuf[ idx + 1 ] * a1 + rampBuf[ idx + 1 ] * a2 ) >> 8;
		}
		rampBuf.set( mixBuf.subarray( tickLen * 2, ( tickLen + 64 ) * 2 ) );
	}
	var downsample = function( buf, count ) {
		// 2:1 downsampling with simple but effective anti-aliasing.
		// Buf must contain count * 2 + 1 stereo samples.
		var outLen = count * 2;
		for( inIdx = 0, outIdx = 0; outIdx < outLen; inIdx += 4, outIdx += 2 ) {
			buf[ outIdx     ] = ( buf[ inIdx     ] >> 2 ) + ( buf[ inIdx + 2 ] >> 1 ) + ( buf[ inIdx + 4 ] >> 2 );
			buf[ outIdx + 1 ] = ( buf[ inIdx + 1 ] >> 2 ) + ( buf[ inIdx + 3 ] >> 1 ) + ( buf[ inIdx + 5 ] >> 2 );
		}
	}
	var seqTick = function() {
		var songEnd = false;
		if( --tick <= 0 ) {
			tick = speed;
			songEnd = seqRow();
		} else {
			for( var idx = 0; idx < module.numChannels; idx++ ) {
				channels[ idx ].tick();
			}
		}
		return songEnd;
	}
	var seqRow = function() {
		var songEnd = false;
		if( breakSeqPos >= 0 ) {
			if( breakSeqPos >= module.sequenceLength ) {
				breakSeqPos = nextRow = 0;
			}
			if( breakSeqPos <= seqPos ) {
				songEnd = true;
			}
			seqPos = breakSeqPos;
			for( var idx = 0; idx < module.numChannels; idx++ ) {
				channels[ idx ].plRow = 0;
			}
			breakSeqPos = -1;
		}
		var pattern = module.patterns[ module.sequence[ seqPos ] ];
		row = nextRow;
		if( row >= pattern.numRows ) row = 0;
		nextRow = row + 1;
		if( nextRow >= pattern.numRows ) {
			breakSeqPos = seqPos + 1;
			nextRow = 0;
		}
		var noteIdx = row * module.numChannels;
		for( var chanIdx = 0; chanIdx < module.numChannels; chanIdx++ ) {
			var channel = channels[ chanIdx ];
			pattern.getNote( noteIdx + chanIdx, note );
			if( note.effect == 0xE ) {
				note.effect = 0x70 | ( note.param >> 4 );
				note.param &= 0xF;
			}
			if( note.effect == 0x93 ) {
				note.effect = 0xF0 | ( note.param >> 4 );
				note.param &= 0xF;
			}
			if( note.effect == 0 && note.param > 0 ) note.effect = 0x8A;
			channel.row( note );
			switch( note.effect ) {
				case 0x81: /* Set Speed. */
					if( note.param > 0 )
						tick = speed = note.param;
					break;
				case 0xB: case 0x82: /* Pattern Jump.*/
					if( plCount < 0 ) {
						breakSeqPos = note.param;
						nextRow = 0;
					}
					break;
				case 0xD: case 0x83: /* Pattern Break.*/
					if( plCount < 0 ) {
						breakSeqPos = seqPos + 1;
						nextRow = ( note.param >> 4 ) * 10 + ( note.param & 0xF );
					}
					break;
				case 0xF: /* Set Speed/Tempo.*/
					if( note.param > 0 ) {
						if( note.param < 32 )
							tick = speed = note.param;
						else
							tempo = note.param;
					}
					break;
				case 0x94: /* Set Tempo.*/
					if( note.param > 32 )
						tempo = note.param;
					break;
				case 0x76: case 0xFB : /* Pattern Loop.*/
					if( note.param == 0 ) /* Set loop marker on this channel. */
						channel.plRow = row;
					if( channel.plRow < row ) { /* Marker valid. Begin looping. */
						if( plCount < 0 ) { /* Not already looping, begin. */
							plCount = note.param;
							plChannel = chanIdx;
						}
						if( plChannel == chanIdx ) { /* Next Loop.*/
							if( plCount == 0 ) { /* Loop finished. */
								/* Invalidate current marker. */
								channel.plRow = row + 1;
							} else { /* Loop and cancel any breaks on this row. */
								nextRow = channel.plRow;
								breakSeqPos = -1;
							}
							plCount--;
						}
					}
					break;
				case 0x7E: case 0xFE: /* Pattern Delay.*/
					tick = speed + speed * note.param;
					break;
			}
		}
		return songEnd;
	}
	var interpolation = false;
	var rampBuf = new Int32Array( 64 * 2 );
	var mixBuf = new Int32Array( ( calculateTickLen( 32, 128000 ) + 65 ) * 4 );
	var mixIdx = 0, mixLen = 0;
	var seqPos = 0, breakSeqPos = 0, row = 0, nextRow = 0, tick = 0;
	var speed = 0, tempo = 0, plCount = 0, plChannel = 0;
	var channels = new Array( module.numChannels );
	var note = new IBXMNote();
	this.module = module;
	this.globalVol = 0;
	this.setSamplingRate( samplingRate );
	this.setSequencePos( 0 );
}

function IBXMChannel( replay, id ) {
	var instrument = new IBXMInstrument();
	var sample = instrument.samples[ 0 ];
	var keyOn = false;
	var noteKey = 0, noteIns = 0, noteVol = 0, noteEffect = 0, noteParam = 0;
	var sampleOffset = 0, sampleIdx = 0, sampleFra = 0, freq = 0, ampl = 0, pann = 0;
	var volume = 0, panning = replay.module.defaultPanning[ id ];
	var fadeOutVol = 0, volEnvTick = 0, panEnvTick = 0;
	var period = 0, portaPeriod = 0, retrigCount = 0, fxCount = 0, autoVibratoCount = 0;
	var portaUpParam = 0, portaDownParam = 0, tonePortaParam = 0, offsetParam = 0;
	var finePortaUpParam = 0, finePortaDownParam = 0, extraFinePortaParam = 0;
	var arpeggioParam = 0, vslideParam = 0, globalVslideParam = 0, panningSlideParam = 0;
	var fineVslideUpParam = 0, fineVslideDownParam = 0;
	var retrigVolume = 0, retrigTicks = 0, tremorOnTicks = 0, tremorOffTicks = 0;
	var vibratoType = 0, vibratoPhase = 0, vibratoSpeed = 0, vibratoDepth = 0;
	var tremoloType = 0, tremoloPhase = 0, tremoloSpeed = 0, tremoloDepth = 0;
	var tremoloAdd = 0, vibratoAdd = 0, arpeggioAdd = 0;
	this.plRow = 0;
	this.resample = function( mixBuffer, offset, count, sampleRate, interpolate ) {
		if( ampl <= 0 ) return;
		var lGain = ampl * ( 255 - pann ) >> 8;
		var rGain = ampl * pann >> 8;
		var step = ( ( freq << ( 0xF - 3 ) ) / ( sampleRate >> 3 ) ) | 0;
		var samIdx = sampleIdx | 0;
		var samFra = sampleFra | 0;
		var loopLen = sample.loopLength | 0;
		var loopEnd = ( sample.loopStart + loopLen ) | 0;
		var sampleData = sample.sampleData;
		var outIdx = offset << 1;
		var outEnd = ( offset + count ) << 1;
		if( interpolate ) {
			while( outIdx < outEnd ) {
				if( samIdx >= loopEnd ) {
					if( loopLen < 2 ) break;
					while( samIdx >= loopEnd ) samIdx -= loopLen;
				}
				var c = sampleData[ samIdx ];
				var m = sampleData[ samIdx + 1 ] - c;
				var y = ( m * samFra >> 0xF ) + c;
				mixBuffer[ outIdx++ ] += y * lGain >> 0xF;
				mixBuffer[ outIdx++ ] += y * rGain >> 0xF;
				samFra += step;
				samIdx += samFra >> 0xF;
				samFra &= 0x7FFF;
			}
		} else {
			while( outIdx < outEnd ) {
				if( samIdx >= loopEnd ) {
					if( loopLen < 2 ) break;
					while( samIdx >= loopEnd ) samIdx -= loopLen;
				}
				var y = sampleData[ samIdx ];
				mixBuffer[ outIdx++ ] += y * lGain >> 0xF;
				mixBuffer[ outIdx++ ] += y * rGain >> 0xF;
				samFra += step;
				samIdx += samFra >> 0xF;
				samFra &= 0x7FFF;
			}
		}
	}
	this.updateSampleIdx = function( count, sampleRate ) {
		var step = ( ( freq << ( 0xF - 3 ) ) / ( sampleRate >> 3 ) ) | 0;
		sampleFra += step * count;
		sampleIdx += sampleFra >> 0xF;
		var loopStart = sample.loopStart;
		var loopLength = sample.loopLength;
		var loopOffset = sampleIdx - loopStart;
		if( loopOffset > 0 ) {
			sampleIdx = loopStart;
			if( loopLength > 1 ) sampleIdx += ( loopOffset % loopLength ) | 0;
		}
		sampleFra &= 0x7FFF;
	}
	this.row = function( note ) {
		noteKey = note.key;
		noteIns = note.instrument;
		noteVol = note.volume;
		noteEffect = note.effect;
		noteParam = note.param;
		retrigCount++;
		vibratoAdd = tremoloAdd = arpeggioAdd = fxCount = 0;
		if( !( ( noteEffect == 0x7D || noteEffect == 0xFD ) && noteParam > 0 ) ) {
			/* Not note delay.*/
			trigger();
		}
		switch( noteEffect ) {
			case 0x01: case 0x86: /* Porta Up. */
				if( noteParam > 0 ) portaUpParam = noteParam;
				portamentoUp( portaUpParam );
				break;
			case 0x02: case 0x85: /* Porta Down. */
				if( noteParam > 0 ) portaDownParam = noteParam;
				portamentoDown( portaDownParam );
				break;
			case 0x03: case 0x87: /* Tone Porta. */
				if( noteParam > 0 ) tonePortaParam = noteParam;
				break;
			case 0x04: case 0x88: /* Vibrato. */
				if( ( noteParam >> 4 ) > 0 ) vibratoSpeed = noteParam >> 4;
				if( ( noteParam & 0xF ) > 0 ) vibratoDepth = noteParam & 0xF;
				vibrato( false );
				break;
			case 0x05: case 0x8C: /* Tone Porta + Vol Slide. */
				if( noteParam > 0 ) vslideParam = noteParam;
				volumeSlide();
				break;
			case 0x06: case 0x8B: /* Vibrato + Vol Slide. */
				if( noteParam > 0 ) vslideParam = noteParam;
				vibrato( false );
				volumeSlide();
				break;
			case 0x07: case 0x92: /* Tremolo. */
				if( ( noteParam >> 4 ) > 0 ) tremoloSpeed = noteParam >> 4;
				if( ( noteParam & 0xF ) > 0 ) tremoloDepth = noteParam & 0xF;
				tremolo();
				break;
			case 0x08: /* Set Panning.*/
				panning = ( noteParam < 128 ) ? ( noteParam << 1 ) : 255;
				break;
			case 0x0A: case 0x84: /* Vol Slide. */
				if( noteParam > 0 ) vslideParam = noteParam;
				volumeSlide();
				break;
			case 0x0C: /* Set Volume. */
				volume = noteParam >= 64 ? 64 : noteParam & 0x3F;
				break;
			case 0x10: case 0x96: /* Set Global Volume. */
				replay.globalVol = noteParam >= 64 ? 64 : noteParam & 0x3F;
				break;
			case 0x11: /* Global Volume Slide. */
				if( noteParam > 0 ) globalVslideParam = noteParam;
				break;
			case 0x14: /* Key Off. */
				keyOn = false;
				break;
			case 0x15: /* Set Envelope Tick. */
				volEnvTick = panEnvTick = noteParam & 0xFF;
				break;
			case 0x19: /* Panning Slide. */
				if( noteParam > 0 ) panningSlideParam = noteParam;
				break;
			case 0x1B: case 0x91: /* Retrig + Vol Slide. */
				if( ( noteParam >> 4 ) > 0 ) retrigVolume = noteParam >> 4;
				if( ( noteParam & 0xF ) > 0 ) retrigTicks = noteParam & 0xF;
				retrigVolSlide();
				break;
			case 0x1D: case 0x89: /* Tremor. */
				if( ( noteParam >> 4 ) > 0 ) tremorOnTicks = noteParam >> 4;
				if( ( noteParam & 0xF ) > 0 ) tremorOffTicks = noteParam & 0xF;
				tremor();
				break;
			case 0x21: /* Extra Fine Porta. */
				if( noteParam > 0 ) extraFinePortaParam = noteParam;
				switch( extraFinePortaParam & 0xF0 ) {
					case 0x10:
						portamentoUp( 0xE0 | ( extraFinePortaParam & 0xF ) );
						break;
					case 0x20:
						portamentoDown( 0xE0 | ( extraFinePortaParam & 0xF ) );
						break;
				}
				break;
			case 0x71: /* Fine Porta Up. */
				if( noteParam > 0 ) finePortaUpParam = noteParam;
				portamentoUp( 0xF0 | ( finePortaUpParam & 0xF ) );
				break;
			case 0x72: /* Fine Porta Down. */
				if( noteParam > 0 ) finePortaDownParam = noteParam;
				portamentoDown( 0xF0 | ( finePortaDownParam & 0xF ) );
				break;
			case 0x74: case 0xF3: /* Set Vibrato Waveform. */
				if( noteParam < 8 ) vibratoType = noteParam;
				break;
			case 0x77: case 0xF4: /* Set Tremolo Waveform. */
				if( noteParam < 8 ) tremoloType = noteParam;
				break;
			case 0x7A: /* Fine Vol Slide Up. */
				if( noteParam > 0 ) fineVslideUpParam = noteParam;
				volume += fineVslideUpParam;
				if( volume > 64 ) volume = 64;
				break;
			case 0x7B: /* Fine Vol Slide Down. */
				if( noteParam > 0 ) fineVslideDownParam = noteParam;
				volume -= fineVslideDownParam;
				if( volume < 0 ) volume = 0;
				break;
			case 0x7C: case 0xFC: /* Note Cut. */
				if( noteParam <= 0 ) volume = 0;
				break;
			case 0x8A: /* Arpeggio. */
				if( noteParam > 0 ) arpeggioParam = noteParam;
				break;
			case 0x95: /* Fine Vibrato.*/
				if( ( noteParam >> 4 ) > 0 ) vibratoSpeed = noteParam >> 4;
				if( ( noteParam & 0xF ) > 0 ) vibratoDepth = noteParam & 0xF;
				vibrato( true );
				break;
			case 0xF8: /* Set Panning. */
				panning = noteParam * 17;
				break;
		}
		autoVibrato();
		calculateFrequency();
		calculateAmplitude();
		updateEnvelopes();
	}
	this.tick = function() {
		vibratoAdd = 0;
		fxCount++;
		retrigCount++;
		if( !( noteEffect == 0x7D && fxCount <= noteParam ) ) {
			switch( noteVol & 0xF0 ) {
				case 0x60: /* Vol Slide Down.*/
					volume -= noteVol & 0xF;
					if( volume < 0 ) volume = 0;
					break;
				case 0x70: /* Vol Slide Up.*/
					volume += noteVol & 0xF;
					if( volume > 64 ) volume = 64;
					break;
				case 0xB0: /* Vibrato.*/
					vibratoPhase += vibratoSpeed;
					vibrato( false );
					break;
				case 0xD0: /* Pan Slide Left.*/
					panning -= noteVol & 0xF;
					if( panning < 0 ) panning = 0;
					break;
				case 0xE0: /* Pan Slide Right.*/
					panning += noteVol & 0xF;
					if( panning > 255 ) panning = 255;
					break;
				case 0xF0: /* Tone Porta.*/
					tonePortamento();
					break;
			}
		}
		switch( noteEffect ) {
			case 0x01: case 0x86: /* Porta Up. */
				portamentoUp( portaUpParam );
				break;
			case 0x02: case 0x85: /* Porta Down. */
				portamentoDown( portaDownParam );
				break;
			case 0x03: case 0x87: /* Tone Porta. */
				tonePortamento();
				break;
			case 0x04: case 0x88: /* Vibrato. */
				vibratoPhase += vibratoSpeed;
				vibrato( false );
				break;
			case 0x05: case 0x8C: /* Tone Porta + Vol Slide. */
				tonePortamento();
				volumeSlide();
				break;
			case 0x06: case 0x8B: /* Vibrato + Vol Slide. */
				vibratoPhase += vibratoSpeed;
				vibrato( false );
				volumeSlide();
				break;
			case 0x07: case 0x92: /* Tremolo. */
				tremoloPhase += tremoloSpeed;
				tremolo();
				break;
			case 0x0A: case 0x84: /* Vol Slide. */
				volumeSlide();
				break;
			case 0x11: /* Global Volume Slide. */
				replay.globalVol += ( globalVslideParam >> 4 ) - ( globalVslideParam & 0xF );
				if( replay.globalVol < 0 ) replay.globalVol = 0;
				if( replay.globalVol > 64 ) replay.globalVol = 64;
				break;
			case 0x19: /* Panning Slide. */
				panning += ( panningSlideParam >> 4 ) - ( panningSlideParam & 0xF );
				if( panning < 0 ) panning = 0;
				if( panning > 255 ) panning = 255;
				break;
			case 0x1B: case 0x91: /* Retrig + Vol Slide. */
				retrigVolSlide();
				break;
			case 0x1D: case 0x89: /* Tremor. */
				tremor();
				break;
			case 0x79: /* Retrig. */
				if( fxCount >= noteParam ) {
					fxCount = 0;
					sampleIdx = sampleFra = 0;
				}
				break;
			case 0x7C: case 0xFC: /* Note Cut. */
				if( noteParam == fxCount ) volume = 0;
				break;
			case 0x7D: case 0xFD: /* Note Delay. */
				if( noteParam == fxCount ) trigger();
				break;
			case 0x8A: /* Arpeggio. */
				if( fxCount > 2 ) fxCount = 0;
				if( fxCount == 0 ) arpeggioAdd = 0;
				if( fxCount == 1 ) arpeggioAdd = arpeggioParam >> 4;
				if( fxCount == 2 ) arpeggioAdd = arpeggioParam & 0xF;
				break;
			case 0x95: /* Fine Vibrato. */
				vibratoPhase += vibratoSpeed;
				vibrato( true );
				break;
		}
		autoVibrato();
		calculateFrequency();
		calculateAmplitude();
		updateEnvelopes();
	}
	var updateEnvelopes = function() {
		if( instrument.volumeEnvelope.enabled ) {
			if( !keyOn ) {
				fadeOutVol -= instrument.volumeFadeOut;
				if( fadeOutVol < 0 ) fadeOutVol = 0;
			}
			volEnvTick = instrument.volumeEnvelope.nextTick( volEnvTick, keyOn );
		}
		if( instrument.panningEnvelope.enabled )
			panEnvTick = instrument.panningEnvelope.nextTick( panEnvTick, keyOn );
	}
	var autoVibrato = function() {
		var depth = instrument.vibratoDepth & 0x7F;
		if( depth > 0 ) {
			var sweep = instrument.vibratoSweep & 0x7F;
			var rate = instrument.vibratoRate & 0x7F;
			var type = instrument.vibratoType;
			if( autoVibratoCount < sweep ) depth = depth * autoVibratoCount / sweep;
			vibratoAdd += replay.module.waveform( autoVibratoCount * rate >> 2, type + 4 ) * depth >> 8;
			autoVibratoCount++;
		}
	}
	var volumeSlide = function() {
		var up = vslideParam >> 4;
		var down = vslideParam & 0xF;
		if( down == 0xF && up > 0 ) { /* Fine slide up.*/
			if( fxCount == 0 ) volume += up;
		} else if( up == 0xF && down > 0 ) { /* Fine slide down.*/
			if( fxCount == 0 ) volume -= down;
		} else if( fxCount > 0 || replay.module.fastVolSlides ) /* Normal.*/
			volume += up - down;
		if( volume > 64 ) volume = 64;
		if( volume < 0 ) volume = 0;
	}
	var portamentoUp = function( param ) {
		switch( param & 0xF0 ) {
			case 0xE0: /* Extra-fine porta.*/
				if( fxCount == 0 ) period -= param & 0xF;
				break;
			case 0xF0: /* Fine porta.*/
				if( fxCount == 0 ) period -= ( param & 0xF ) << 2;
				break;
			default:/* Normal porta.*/
				if( fxCount > 0 ) period -= param << 2;
				break;
		}
		if( period < 0 ) period = 0;
	}
	var portamentoDown = function( param ) {
		if( period > 0 ) {
			switch( param & 0xF0 ) {
				case 0xE0: /* Extra-fine porta.*/
					if( fxCount == 0 ) period += param & 0xF;
					break;
				case 0xF0: /* Fine porta.*/
					if( fxCount == 0 ) period += ( param & 0xF ) << 2;
					break;
				default:/* Normal porta.*/
					if( fxCount > 0 ) period += param << 2;
					break;
			}
			if( period > 65535 ) period = 65535;
		}
	}
	var tonePortamento = function() {
		if( period > 0 ) {
			if( period < portaPeriod ) {
				period += tonePortaParam << 2;
				if( period > portaPeriod ) period = portaPeriod;
			} else {
				period -= tonePortaParam << 2;
				if( period < portaPeriod ) period = portaPeriod;
			}
		}
	}
	var vibrato = function( fine ) {
		vibratoAdd = replay.module.waveform( vibratoPhase, vibratoType & 0x3 ) * vibratoDepth >> ( fine ? 7 : 5 );
	}
	var tremolo = function() {
		tremoloAdd = replay.module.waveform( tremoloPhase, tremoloType & 0x3 ) * tremoloDepth >> 6;
	}
	var tremor = function() {
		if( retrigCount >= tremorOnTicks ) tremoloAdd = -64;
		if( retrigCount >= ( tremorOnTicks + tremorOffTicks ) )
			tremoloAdd = retrigCount = 0;
	}
	var retrigVolSlide = function() {
		if( retrigCount >= retrigTicks ) {
			retrigCount = sampleIdx = sampleFra = 0;
			switch( retrigVolume ) {
				case 0x1: volume -=  1; break;
				case 0x2: volume -=  2; break;
				case 0x3: volume -=  4; break;
				case 0x4: volume -=  8; break;
				case 0x5: volume -= 16; break;
				case 0x6: volume -= volume / 3; break;
				case 0x7: volume >>= 1; break;
				case 0x8: /* ? */ break;
				case 0x9: volume +=  1; break;
				case 0xA: volume +=  2; break;
				case 0xB: volume +=  4; break;
				case 0xC: volume +=  8; break;
				case 0xD: volume += 16; break;
				case 0xE: volume += volume >> 1; break;
				case 0xF: volume <<= 1; break;
			}
			if( volume <  0 ) volume = 0;
			if( volume > 64 ) volume = 64;
		}
	}
	var calculateFrequency = function() {
		freq = replay.module.periodToFreq( period + vibratoAdd, arpeggioAdd );
	}
	var calculateAmplitude = function() {
		var envVol = keyOn ? 64 : 0;
		if( instrument.volumeEnvelope.enabled )
			envVol = instrument.volumeEnvelope.calculateAmpl( volEnvTick );
		var vol = volume + tremoloAdd;
		if( vol > 64 ) vol = 64;
		if( vol < 0 ) vol = 0;
		vol = ( vol * replay.module.gain * 0x8000 ) >> 13;
		vol = ( vol * fadeOutVol ) >> 15;
		ampl = ( vol * replay.globalVol * envVol ) >> 12;
		var envPan = 32;
		if( instrument.panningEnvelope.enabled )
			envPan = instrument.panningEnvelope.calculateAmpl( panEnvTick );
		var panRange = ( panning < 128 ) ? panning : ( 255 - panning );
		pann = panning + ( panRange * ( envPan - 32 ) >> 5 );
	}
	var trigger = function() {
		if( noteIns > 0 && noteIns <= replay.module.numInstruments ) {
			instrument = replay.module.instruments[ noteIns ];
			var sam = instrument.samples[ instrument.keyToSample[ noteKey < 97 ? noteKey : 0 ] ];
			volume = sam.volume >= 64 ? 64 : sam.volume & 0x3F;
			if( sam.panning >= 0 ) panning = sam.panning & 0xFF;
			if( period > 0 && sam.loopLength > 1 ) sample = sam; /* Amiga trigger.*/
			sampleOffset = volEnvTick = panEnvTick = 0;
			fadeOutVol = 32768;
			keyOn = true;
		}
		if( noteEffect == 0x09 || noteEffect == 0x8F ) { /* Set Sample Offset. */
			if( noteParam > 0 ) offsetParam = noteParam;
			sampleOffset = offsetParam << 8;
		}
		if( noteVol >= 0x10 && noteVol < 0x60 )
			volume = noteVol < 0x50 ? noteVol - 0x10 : 64;
		switch( noteVol & 0xF0 ) {
			case 0x80: /* Fine Vol Down.*/
				volume -= noteVol & 0xF;
				if( volume < 0 ) volume = 0;
				break;
			case 0x90: /* Fine Vol Up.*/
				volume += noteVol & 0xF;
				if( volume > 64 ) volume = 64;
				break;
			case 0xA0: /* Set Vibrato Speed.*/
				if( ( noteVol & 0xF ) > 0 ) vibratoSpeed = noteVol & 0xF;
				break;
			case 0xB0: /* Vibrato.*/
				if( ( noteVol & 0xF ) > 0 ) vibratoDepth = noteVol & 0xF;
				vibrato( false );
				break;
			case 0xC0: /* Set Panning.*/
				panning = ( noteVol & 0xF ) * 17;
				break;
			case 0xF0: /* Tone Porta.*/
				if( ( noteVol & 0xF ) > 0 ) tonePortaParam = noteVol & 0xF;
				break;
		}
		if( noteKey > 0 ) {
			if( noteKey > 96 ) {
				keyOn = false;
			} else {
				var isPorta = ( noteVol & 0xF0 ) == 0xF0 ||
					noteEffect == 0x03 || noteEffect == 0x05 ||
					noteEffect == 0x87 || noteEffect == 0x8C;
				if( !isPorta ) sample = instrument.samples[ instrument.keyToSample[ noteKey ] ];
				var fineTune = sample.fineTune;
				if( noteEffect == 0x75 || noteEffect == 0xF2 ) { /* Set Fine Tune. */
					fineTune = ( noteParam & 0xF ) << 4;
					if( fineTune > 127 ) fineTune -= 256;
				}
				var key = noteKey + sample.relNote;
				if( key < 1 ) key = 1;
				if( key > 120 ) key = 120;
				var per = replay.module.keyToPeriod( key, fineTune );
				per = replay.module.c2Rate * per * 2 / sample.c2Rate;
				portaPeriod = ( per >> 1 ) + ( per & 1 );
				if( !isPorta ) {
					period = portaPeriod;
					sampleIdx = sampleOffset;
					sampleFra = 0;
					if( vibratoType < 4 ) vibratoPhase = 0;
					if( tremoloType < 4 ) tremoloPhase = 0;
					retrigCount = autoVibratoCount = 0;
				}
			}
		}
	}
}

function IBXMNote() {
	this.key = 0;
	this.instrument = 0;
	this.volume = 0;
	this.effect = 0;
	this.param = 0;
}

function IBXMPattern( numChannels, numRows ) {
	this.numRows = numRows;
	this.data = new Int8Array( numChannels * numRows * 5 );
	this.getNote = function( index, note ) {
		var offset = index * 5;
		note.key = this.data[ offset ] & 0xFF;
		note.instrument = this.data[ offset + 1 ] & 0xFF;
		note.volume = this.data[ offset + 2 ] & 0xFF;
		note.effect = this.data[ offset + 3 ] & 0xFF;
		note.param = this.data[ offset + 4 ] & 0xFF;
	}
}

function IBXMInstrument() {
	this.name = "";
	this.numSamples = 1;
	this.vibratoType = 0;
	this.vibratoSweep = 0;
	this.vibratoDepth = 0;
	this.vibratoRate = 0;
	this.volumeFadeOut = 0;
	this.volumeEnvelope = new IBXMEnvelope();
	this.panningEnvelope = new IBXMEnvelope();
	this.keyToSample = new Int8Array( 97 );
	this.samples = [ new IBXMSample() ];
}

function IBXMEnvelope() {
	this.enabled = false;
	this.sustain = false;
	this.looped = false;
	this.sustainTick = 0;
	this.loopStartTick = 0;
	this.loopEndTick = 0;
	this.numPoints = 1;
	this.pointsTick = new Int32Array( 1 );
	this.pointsAmpl = new Int32Array( 1 );
	this.nextTick = function( tick, keyOn ) {
		tick++;
		if( this.looped && tick >= this.loopEndTick ) tick = this.loopStartTick;
		if( this.sustain && keyOn && tick >= this.sustainTick ) tick = this.sustainTick;
		return tick;
	}
	this.calculateAmpl = function( tick ) {
		var ampl = this.pointsAmpl[ this.numPoints - 1 ];
		if( tick < this.pointsTick[ this.numPoints - 1 ] ) {
			var point = 0;
			for( var idx = 1; idx < this.numPoints; idx++ )
				if( this.pointsTick[ idx ] <= tick ) point = idx;
			var dt = this.pointsTick[ point + 1 ] - this.pointsTick[ point ];
			var da = this.pointsAmpl[ point + 1 ] - this.pointsAmpl[ point ];
			ampl = this.pointsAmpl[ point ];
			ampl += ( ( da << 24 ) / dt ) * ( tick - this.pointsTick[ point ] ) >> 24;
		}
		return ampl;
	}
}

function IBXMSample() {
	this.name = "";
	this.volume = 0;
	this.panning = -1;
	this.relNote = 0;
	this.fineTune = 0;
	this.c2Rate = 8363;
	this.loopStart = 0;
	this.loopLength = 0;
	this.sampleData = new Int16Array( 1 );
	this.setSampleData = function( sampleData, loopStart, loopLength, pingPong ) {
		var sampleLength = sampleData.length;
		// Fix loop if necessary.
		if( loopStart < 0 || loopStart > sampleLength )
			loopStart = sampleLength;
		if( loopLength < 0 || ( loopStart + loopLength ) > sampleLength )
			loopLength = sampleLength - loopStart;
		sampleLength = loopStart + loopLength;
		// Allocate new sample.
		var newSampleData = new Int16Array( sampleLength + ( pingPong ? loopLength : 0 ) + 1 );
		newSampleData.set( sampleData.subarray( 0, sampleLength ) );
		sampleData = newSampleData;
		if( pingPong ) {
			// Calculate reversed loop.
			for( var idx = 0; idx < loopLength; idx++ )
				sampleData[ sampleLength + idx ] = sampleData[ sampleLength - idx - 1 ];
			loopLength *= 2;
		}
		// Extend loop for linear interpolation.
		sampleData[ loopStart + loopLength ] = sampleData[ loopStart ];
		this.sampleData = sampleData;
		this.loopStart = loopStart;
		this.loopLength = loopLength;
	}
}

function IBXMData( buffer ) {
	this.sByte = function( offset ) {
		return buffer[ offset ] | 0;
	}
	this.uByte = function( offset ) {
		return buffer[ offset ] & 0xFF;
	}
	this.ubeShort = function( offset ) {
		return ( ( buffer[ offset ] & 0xFF ) << 8 ) | ( buffer[ offset + 1 ] & 0xFF );
	}
	this.uleShort = function( offset ) {
		return ( buffer[ offset ] & 0xFF ) | ( ( buffer[ offset + 1 ] & 0xFF ) << 8 );
	}
	this.uleInt = function( offset ) {
		var value = buffer[ offset ] & 0xFF;
		value = value | ( ( buffer[ offset + 1 ] & 0xFF ) << 8 );
		value = value | ( ( buffer[ offset + 2 ] & 0xFF ) << 16 );
		value = value | ( ( buffer[ offset + 3 ] & 0x7F ) << 24 );
		return value;
	}
	this.strLatin1 = function( offset, length ) {
		var str = new Array( length );
		for( var idx = 0; idx < length; idx++ ) {
			var chr = buffer[ offset + idx ] & 0xFF;
			str[ idx ] = String.fromCharCode( chr < 32 ? 32 : chr );
		}
		return str.join('');
	}
	this.samS8 = function( offset, length ) {
		var sampleData = new Int16Array( length );
		for( var idx = 0; idx < length; idx++ ) {
			sampleData[ idx ] = buffer[ offset + idx ] << 8;
		}
		return sampleData;
	}
	this.samS8D = function( offset, length ) {
		var sampleData = new Int16Array( length );
		var sam = 0;
		for( var idx = 0; idx < length; idx++ ) {
			sam += buffer[ offset + idx ] | 0;
			sampleData[ idx ] = sam << 8;
		}
		return sampleData;
	}
	this.samU8 = function( offset, length ) {
		var sampleData = new Int16Array( length );
		for( var idx = 0; idx < length; idx++ ) {
			sampleData[ idx ] = ( ( buffer[ offset + idx ] & 0xFF ) - 128 ) << 8;
		}
		return sampleData;
	}
	this.samS16 = function( offset, samples ) {
		var sampleData = new Int16Array( samples );
		for( var idx = 0; idx < samples; idx++ ) {
			sampleData[ idx ] = ( buffer[ offset + idx * 2 ] & 0xFF ) | ( buffer[ offset + idx * 2 + 1 ] << 8 );
		}
		return sampleData;
	}
	this.samS16D = function( offset, samples ) {
		var sampleData = new Int16Array( samples );
		var sam = 0;
		for( var idx = 0; idx < samples; idx++ ) {
			sam += ( buffer[ offset + idx * 2 ] & 0xFF ) | ( buffer[ offset + idx * 2 + 1 ] << 8 );
			sampleData[ idx ] = sam;
		}
		return sampleData;
	}
	this.samU16 = function( offset, samples ) {
		var sampleData = new Int16Array( samples );
		for( var idx = 0; idx < samples; idx++ ) {
			var sam = ( buffer[ offset + idx * 2 ] & 0xFF ) | ( ( buffer[ offset + idx * 2 + 1 ] & 0xFF ) << 8 );
			sampleData[ idx ] = sam - 32768;
		}
		return sampleData;
	}
}

function IBXMModule( moduleData ) {
	this.songName = "Blank";
	this.numChannels = 4;
	this.numInstruments = 1;
	this.numPatterns = 1;
	this.sequenceLength = 1;
	this.restartPos = 0;
	this.defaultGVol = 64;
	this.defaultSpeed = 6;
	this.defaultTempo = 125;
	this.c2Rate = 8287;
	this.gain = 64;
	this.linearPeriods = false;
	this.fastVolSlides = false;
	this.defaultPanning = new Int32Array( [ 51, 204, 204, 51 ] );
	this.sequence = new Int32Array( 1 );
	this.patterns = [ new IBXMPattern( 4, 64 ) ];
	this.instruments = [ new IBXMInstrument(), new IBXMInstrument() ];
	this.periodTable = new Int16Array([
		/* Periods for keys 0 to 15 with 8 finetune values. */
		29021, 28812, 28605, 28399, 28195, 27992, 27790, 27590,
		27392, 27195, 26999, 26805, 26612, 26421, 26231, 26042,
		25855, 25669, 25484, 25301, 25119, 24938, 24758, 24580,
		24403, 24228, 24054, 23881, 23709, 23538, 23369, 23201,
		23034, 22868, 22704, 22540, 22378, 22217, 22057, 21899,
		21741, 21585, 21429, 21275, 21122, 20970, 20819, 20670,
		20521, 20373, 20227, 20081, 19937, 19793, 19651, 19509,
		19369, 19230, 19091, 18954, 18818, 18682, 18548, 18414,
		18282, 18150, 18020, 17890, 17762, 17634, 17507, 17381,
		17256, 17132, 17008, 16886, 16765, 16644, 16524, 16405,
		16287, 16170, 16054, 15938, 15824, 15710, 15597, 15485,
		15373, 15263, 15153, 15044, 14936, 14828, 14721, 14616,
		14510, 14406, 14302, 14199, 14097, 13996, 13895, 13795,
		13696, 13597, 13500, 13403, 13306, 13210, 13115, 13021,
		12927, 12834, 12742, 12650, 12559, 12469, 12379, 12290,
		12202, 12114, 12027, 11940, 11854, 11769, 11684, 11600
	]);
	this.freqTable = new Int32Array([
		/* Frequency for keys 109 to 121 with 8 fractional values. */
		267616, 269555, 271509, 273476, 275458, 277454, 279464, 281489,
		283529, 285584, 287653, 289738, 291837, 293952, 296082, 298228,
		300389, 302566, 304758, 306966, 309191, 311431, 313688, 315961,
		318251, 320557, 322880, 325220, 327576, 329950, 332341, 334749,
		337175, 339618, 342079, 344558, 347055, 349570, 352103, 354655,
		357225, 359813, 362420, 365047, 367692, 370356, 373040, 375743,
		378466, 381209, 383971, 386754, 389556, 392379, 395222, 398086,
		400971, 403877, 406803, 409751, 412720, 415711, 418723, 421758,
		424814, 427892, 430993, 434116, 437262, 440430, 443622, 446837,
		450075, 453336, 456621, 459930, 463263, 466620, 470001, 473407,
		476838, 480293, 483773, 487279, 490810, 494367, 497949, 501557,
		505192, 508853, 512540, 516254, 519995, 523763, 527558, 531381,
		535232, 539111, 543017, 546952, 550915, 554908, 558929, 562979
	]);
	this.sineTable = new Int16Array([
		   0,  24,  49,  74,  97, 120, 141, 161, 180, 197, 212, 224, 235, 244, 250, 253,
		 255, 253, 250, 244, 235, 224, 212, 197, 180, 161, 141, 120,  97,  74,  49,  24
	]);
	this.keyToPeriod = function( key, fineTune ) {
		if( this.linearPeriods ) {
			return 7744 - ( key << 6 ) - ( fineTune >> 1 );
		} else {
			var tone = ( key << 6 ) + ( fineTune >> 1 );
			var i = ( tone >> 3 ) % 96;
			var c = this.periodTable[ i ] * 2;
			var m = this.periodTable[ i + 1 ] * 2 - c;
			var x = tone & 0x7;
			var y = ( ( ( m * x ) >> 3 ) + c ) >> ( ( tone / 768 ) | 0 );
			return ( y >> 1 ) + ( y & 1 );
		}
	}
	this.periodToKey = function( period ) {
		var key = 0, oct = 0;
		while( period < this.periodTable[ 96 ] ) {
			period = period << 1;
			oct++;
		}
		while( key < 12 ) {
			var d1 = this.periodTable[ key << 3 ] - period;
			var d2 = period - this.periodTable[ ( key + 1 ) << 3 ];
			if( d2 >= 0 ) {
				if( d2 < d1 ) key++;
				break;
			}
			key++;
		}
		return oct * 12 + key;
	}
	this.periodToFreq = function( period, keyAdd ) {
		if( this.linearPeriods ) {
			period = period - ( keyAdd << 6 );
			if( period < 28 || period > 7680 ) period = 7680;
			var tone = 7680 - period;
			var i = ( tone >> 3 ) % 96;
			var c = this.freqTable[ i ];
			var m = this.freqTable[ i + 1 ] - c;
			var x = tone & 0x7;
			var y = ( ( m * x ) >> 3 ) + c;
			return y >> ( 9 - ( ( tone / 768 ) | 0 ) );
		} else {
			period = period * ( this.periodTable[ ( keyAdd & 0xF ) << 3 ] << 1 ) / this.periodTable[ 0 ];
			period = ( period >> 1 ) + ( period & 1 );
			if( period < 28 ) period = this.periodTable[ 0 ];
			return ( this.c2Rate * 1712 / period ) | 0;
		}
	}
	this.waveform = function( phase, type ) {
		var amplitude = 0;
		switch( type ) {
			default: /* Sine. */
				amplitude = this.sineTable[ phase & 0x1F ];
				if( ( phase & 0x20 ) > 0 ) amplitude = -amplitude;
				break;
			case 6: /* Saw Up.*/
				amplitude = ( ( ( phase + 0x20 ) & 0x3F ) << 3 ) - 255;
				break;
			case 1: case 7: /* Saw Down. */
				amplitude = 255 - ( ( ( phase + 0x20 ) & 0x3F ) << 3 );
				break;
			case 2: case 5: /* Square. */
				amplitude = ( phase & 0x20 ) > 0 ? 255 : -255;
				break;
			/* Random.
			case 3: case 8: 
				amplitude = ( randomSeed >> 20 ) - 255;
				randomSeed = ( randomSeed * 65 + 17 ) & 0x1FFFFFFF;
				break;*/
		}
		return amplitude;
	}
	this.loadXM = function( moduleData ) {
		if( moduleData.uleShort( 58 ) != 0x0104 )
			throw "XM format version must be 0x0104!";
		this.songName = moduleData.strLatin1( 17, 20 );
		var deltaEnv = moduleData.strLatin1( 38, 20 ).startsWith( "DigiBooster Pro" );
		var dataOffset = 60 + moduleData.uleInt( 60 );
		this.sequenceLength = moduleData.uleShort( 64 );
		this.restartPos = moduleData.uleShort( 66 );
		this.numChannels = moduleData.uleShort( 68 );
		this.numPatterns = moduleData.uleShort( 70 );
		this.numInstruments = moduleData.uleShort( 72 );
		this.linearPeriods = ( moduleData.uleShort( 74 ) & 0x1 ) > 0;
		this.defaultGVol = 64;
		this.defaultSpeed = moduleData.uleShort( 76 );
		this.defaultTempo = moduleData.uleShort( 78 );
		this.c2Rate = 8363;
		this.gain = 64;
		this.defaultPanning = new Int32Array( this.numChannels );
		for( var idx = 0; idx < this.numChannels; idx++ ) this.defaultPanning[ idx ] = 128;
		this.sequence = new Int32Array( this.sequenceLength );
		for( var seqIdx = 0; seqIdx < this.sequenceLength; seqIdx++ ) {
			var entry = moduleData.uByte( 80 + seqIdx );
			this.sequence[ seqIdx ] = entry < this.numPatterns ? entry : 0;
		}
		this.patterns = new Array( this.numPatterns );
		for( var patIdx = 0; patIdx < this.numPatterns; patIdx++ ) {
			if( moduleData.uByte( dataOffset + 4 ) != 0 )
				throw "Unknown pattern packing type!";
			var numRows = moduleData.uleShort( dataOffset + 5 );
			var numNotes = numRows * this.numChannels;
			var pattern = this.patterns[ patIdx ] = new IBXMPattern( this.numChannels, numRows );
			var patternDataLength = moduleData.uleShort( dataOffset + 7 );
			dataOffset += moduleData.uleInt( dataOffset );
			var nextOffset = dataOffset + patternDataLength;
			if( patternDataLength > 0 ) {
				var patternDataOffset = 0;
				for( var note = 0; note < numNotes; note++ ) {
					var flags = moduleData.uByte( dataOffset );
					if( ( flags & 0x80 ) == 0 ) flags = 0x1F; else dataOffset++;
					var key = ( flags & 0x01 ) > 0 ? moduleData.sByte( dataOffset++ ) : 0;
					pattern.data[ patternDataOffset++ ] = key;
					var ins = ( flags & 0x02 ) > 0 ? moduleData.sByte( dataOffset++ ) : 0;
					pattern.data[ patternDataOffset++ ] = ins;
					var vol = ( flags & 0x04 ) > 0 ? moduleData.sByte( dataOffset++ ) : 0;
					pattern.data[ patternDataOffset++ ] = vol;
					var fxc = ( flags & 0x08 ) > 0 ? moduleData.sByte( dataOffset++ ) : 0;
					var fxp = ( flags & 0x10 ) > 0 ? moduleData.sByte( dataOffset++ ) : 0;
					if( fxc >= 0x40 ) fxc = fxp = 0;
					pattern.data[ patternDataOffset++ ] = fxc;
					pattern.data[ patternDataOffset++ ] = fxp;
				}
			}
			dataOffset = nextOffset;
		}
		this.instruments = new Array( this.numInstruments + 1 );
		this.instruments[ 0 ] = new IBXMInstrument();
		for( var insIdx = 1; insIdx <= this.numInstruments; insIdx++ ) {
			var instrument = this.instruments[ insIdx ] = new IBXMInstrument();
			instrument.name = moduleData.strLatin1( dataOffset + 4, 22 );
			var numSamples = instrument.numSamples = moduleData.uleShort( dataOffset + 27 );
			if( numSamples > 0 ) {
				instrument.samples = new Array( numSamples );
				for( var keyIdx = 0; keyIdx < 96; keyIdx++ )
					instrument.keyToSample[ keyIdx + 1 ] = moduleData.uByte( dataOffset + 33 + keyIdx );
				var volEnv = instrument.volumeEnvelope = new IBXMEnvelope();
				volEnv.pointsTick = new Int32Array( 16 );
				volEnv.pointsAmpl = new Int32Array( 16 );
				var pointTick = 0;
				for( var point = 0; point < 12; point++ ) {
					var pointOffset = dataOffset + 129 + ( point * 4 );
					pointTick = ( deltaEnv ? pointTick : 0 ) + moduleData.uleShort( pointOffset );
					volEnv.pointsTick[ point ] = pointTick;
					volEnv.pointsAmpl[ point ] = moduleData.uleShort( pointOffset + 2 );
				}
				var panEnv = instrument.panningEnvelope = new IBXMEnvelope();
				panEnv.pointsTick = new Int32Array( 16 );
				panEnv.pointsAmpl = new Int32Array( 16 );
				pointTick = 0;
				for( var point = 0; point < 12; point++ ) {
					var pointOffset = dataOffset + 177 + ( point * 4 );
					pointTick = ( deltaEnv ? pointTick : 0 ) + moduleData.uleShort( pointOffset );
					panEnv.pointsTick[ point ] = pointTick;
					panEnv.pointsAmpl[ point ] = moduleData.uleShort( pointOffset + 2 );
				}
				volEnv.numPoints = moduleData.uByte( dataOffset + 225 );
				if( volEnv.numPoints > 12 ) volEnv.numPoints = 0;
				panEnv.numPoints = moduleData.uByte( dataOffset + 226 );
				if( panEnv.numPoints > 12 ) panEnv.numPoints = 0;
				volEnv.sustainTick = volEnv.pointsTick[ moduleData.uByte( dataOffset + 227 ) & 0xF ];
				volEnv.loopStartTick = volEnv.pointsTick[ moduleData.uByte( dataOffset + 228 ) & 0xF ];
				volEnv.loopEndTick = volEnv.pointsTick[ moduleData.uByte( dataOffset + 229 ) & 0xF ];
				panEnv.sustainTick = panEnv.pointsTick[ moduleData.uByte( dataOffset + 230 ) & 0xF ];
				panEnv.loopStartTick = panEnv.pointsTick[ moduleData.uByte( dataOffset + 231 ) & 0xF ];
				panEnv.loopEndTick = panEnv.pointsTick[ moduleData.uByte( dataOffset + 232 ) & 0xF ];
				volEnv.enabled = volEnv.numPoints > 0 && ( moduleData.uByte( dataOffset + 233 ) & 0x1 ) > 0;
				volEnv.sustain = ( moduleData.uByte( dataOffset + 233 ) & 0x2 ) > 0;
				volEnv.looped = ( moduleData.uByte( dataOffset + 233 ) & 0x4 ) > 0;
				panEnv.enabled = panEnv.numPoints > 0 && ( moduleData.uByte( dataOffset + 234 ) & 0x1 ) > 0;
				panEnv.sustain = ( moduleData.uByte( dataOffset + 234 ) & 0x2 ) > 0;
				panEnv.looped = ( moduleData.uByte( dataOffset + 234 ) & 0x4 ) > 0;
				instrument.vibratoType = moduleData.uByte( dataOffset + 235 );
				instrument.vibratoSweep = moduleData.uByte( dataOffset + 236 );
				instrument.vibratoDepth = moduleData.uByte( dataOffset + 237 );
				instrument.vibratoRate = moduleData.uByte( dataOffset + 238 );
				instrument.volumeFadeOut = moduleData.uleShort( dataOffset + 239 );
			}
			dataOffset += moduleData.uleInt( dataOffset );
			var sampleHeaderOffset = dataOffset;
			dataOffset += numSamples * 40;
			for( var samIdx = 0; samIdx < numSamples; samIdx++ ) {
				var sample = instrument.samples[ samIdx ] = new IBXMSample();
				var sampleDataBytes = moduleData.uleInt( sampleHeaderOffset );
				var sampleLoopStart = moduleData.uleInt( sampleHeaderOffset + 4 );
				var sampleLoopLength = moduleData.uleInt( sampleHeaderOffset + 8 );
				sample.volume = moduleData.sByte( sampleHeaderOffset + 12 );
				sample.fineTune = moduleData.sByte( sampleHeaderOffset + 13 );
				sample.c2Rate = this.c2Rate;
				var looped = ( moduleData.uByte( sampleHeaderOffset + 14 ) & 0x3 ) > 0;
				var pingPong = ( moduleData.uByte( sampleHeaderOffset + 14 ) & 0x2 ) > 0;
				var sixteenBit = ( moduleData.uByte( sampleHeaderOffset + 14 ) & 0x10 ) > 0;
				sample.panning = moduleData.uByte( sampleHeaderOffset + 15 );
				sample.relNote = moduleData.sByte( sampleHeaderOffset + 16 );
				sample.name = moduleData.strLatin1( sampleHeaderOffset + 18, 22 );
				sampleHeaderOffset += 40;
				if( !looped || ( sampleLoopStart + sampleLoopLength ) > sampleDataBytes ) {
					sampleLoopStart = sampleDataBytes;
					sampleLoopLength = 0;
				}
				if( sixteenBit ) {
					sample.setSampleData( moduleData.samS16D( dataOffset, sampleDataBytes >> 1 ), sampleLoopStart >> 1, sampleLoopLength >> 1, pingPong );
				} else {
					sample.setSampleData( moduleData.samS8D( dataOffset, sampleDataBytes ), sampleLoopStart, sampleLoopLength, pingPong );
				}
				dataOffset += sampleDataBytes;
			}
		}
	}
	this.loadS3M = function( moduleData ) {
		this.songName = moduleData.strLatin1( 0, 28 );
		this.sequenceLength = moduleData.uleShort( 32 );
		this.numInstruments = moduleData.uleShort( 34 );
		this.numPatterns = moduleData.uleShort( 36 );
		var flags = moduleData.uleShort( 38 );
		var version = moduleData.uleShort( 40 );
		this.fastVolSlides = ( ( flags & 0x40 ) == 0x40 ) || version == 0x1300;
		var signedSamples = moduleData.uleShort( 42 ) == 1;
		if( moduleData.uleInt( 44 ) != 0x4d524353 ) throw "Not an S3M file!";
		this.defaultGVol = moduleData.uByte( 48 );
		this.defaultSpeed = moduleData.uByte( 49 );
		this.defaultTempo = moduleData.uByte( 50 );
		this.c2Rate = 8363;
		this.gain = moduleData.uByte( 51 ) & 0x7F;
		var stereoMode = ( moduleData.uByte( 51 ) & 0x80 ) == 0x80;
		var defaultPan = moduleData.uByte( 53 ) == 0xFC;
		var channelMap = new Int32Array( 32 );
		this.numChannels = 0;
		for( var chanIdx = 0; chanIdx < 32; chanIdx++ ) {
			channelMap[ chanIdx ] = -1;
			if( moduleData.uByte( 64 + chanIdx ) < 16 )
				channelMap[ chanIdx ] = this.numChannels++;
		}
		this.sequence = new Int32Array( this.sequenceLength );
		for( var seqIdx = 0; seqIdx < this.sequenceLength; seqIdx++ )
			this.sequence[ seqIdx ] = moduleData.uByte( 96 + seqIdx );
		var moduleDataIdx = 96 + this.sequenceLength;
		this.instruments = new Array( this.numInstruments + 1 );
		this.instruments[ 0 ] = new IBXMInstrument();
		for( var instIdx = 1; instIdx <= this.numInstruments; instIdx++ ) {
			var instrument = this.instruments[ instIdx ] = new IBXMInstrument();
			var sample = instrument.samples[ 0 ];
			var instOffset = moduleData.uleShort( moduleDataIdx ) << 4;
			moduleDataIdx += 2;
			instrument.name = moduleData.strLatin1( instOffset + 48, 28 );
			if( moduleData.uByte( instOffset ) != 1 ) continue;
			if( moduleData.uleShort( instOffset + 76 ) != 0x4353 ) continue;
			var sampleOffset = moduleData.uByte( instOffset + 13 ) << 20;
			sampleOffset += moduleData.uleShort( instOffset + 14 ) << 4;
			var sampleLength = moduleData.uleInt( instOffset + 16 );
			var loopStart = moduleData.uleInt( instOffset + 20 );
			var loopLength = moduleData.uleInt( instOffset + 24 ) - loopStart;
			sample.volume = moduleData.uByte( instOffset + 28 );
			sample.panning = -1;
			var packed = moduleData.uByte( instOffset + 30 ) != 0;
			var loopOn = ( moduleData.uByte( instOffset + 31 ) & 0x1 ) == 0x1;
			if( loopStart + loopLength > sampleLength )
				loopLength = sampleLength - loopStart;
			if( loopLength < 1 || !loopOn ) {
				loopStart = sampleLength;
				loopLength = 0;
			}
			var stereo = ( moduleData.uByte( instOffset + 31 ) & 0x2 ) == 0x2;
			var sixteenBit = ( moduleData.uByte( instOffset + 31 ) & 0x4 ) == 0x4;
			if( packed ) throw "Packed samples not supported!";
			sample.c2Rate = moduleData.uleInt( instOffset + 32 );
			if( sixteenBit ) {
				if( signedSamples ) {
					sample.setSampleData( moduleData.samS16( sampleOffset, sampleLength ), loopStart, loopLength, false );
				} else {
					sample.setSampleData( moduleData.samU16( sampleOffset, sampleLength ), loopStart, loopLength, false );
				}
			} else {
				if( signedSamples ) {
					sample.setSampleData( moduleData.samS8( sampleOffset, sampleLength ), loopStart, loopLength, false );
				} else {
					sample.setSampleData( moduleData.samU8( sampleOffset, sampleLength ), loopStart, loopLength, false );
				}
			}
		}
		this.patterns = new Array( this.numPatterns );
		for( var patIdx = 0; patIdx < this.numPatterns; patIdx++ ) {
			var pattern = this.patterns[ patIdx ] = new IBXMPattern( this.numChannels, 64 );
			var inOffset = ( moduleData.uleShort( moduleDataIdx ) << 4 ) + 2;
			var rowIdx = 0;
			while( rowIdx < 64 ) {
				var token = moduleData.uByte( inOffset++ );
				if( token == 0 ) {
					rowIdx++;
					continue;
				}
				var noteKey = 0;
				var noteIns = 0;
				if( ( token & 0x20 ) == 0x20 ) { //* Key + Instrument.*
					noteKey = moduleData.uByte( inOffset++ );
					noteIns = moduleData.uByte( inOffset++ );
					if( noteKey < 0xFE )
						noteKey = ( noteKey >> 4 ) * 12 + ( noteKey & 0xF ) + 1;
					if( noteKey == 0xFF ) noteKey = 0;
				}
				var noteVol = 0;
				if( ( token & 0x40 ) == 0x40 ) { //* Volume Column.*
					noteVol = ( moduleData.uByte( inOffset++ ) & 0x7F ) + 0x10;
					if( noteVol > 0x50 ) noteVol = 0;
				}
				var noteEffect = 0;
				var noteParam = 0;
				if( ( token & 0x80 ) == 0x80 ) { //* Effect + Param.*
					noteEffect = moduleData.uByte( inOffset++ );
					noteParam = moduleData.uByte( inOffset++ );
					if( noteEffect < 1 || noteEffect >= 0x40 )
						noteEffect = noteParam = 0;
					if( noteEffect > 0 ) noteEffect += 0x80;
				}
				var chanIdx = channelMap[ token & 0x1F ];
				if( chanIdx >= 0 ) {
					var noteOffset = ( rowIdx * this.numChannels + chanIdx ) * 5;
					pattern.data[ noteOffset     ] = noteKey;
					pattern.data[ noteOffset + 1 ] = noteIns;
					pattern.data[ noteOffset + 2 ] = noteVol;
					pattern.data[ noteOffset + 3 ] = noteEffect;
					pattern.data[ noteOffset + 4 ] = noteParam;
				}
			}
			moduleDataIdx += 2;
		}
		this.defaultPanning = new Int32Array( this.numChannels );
		for( var chanIdx = 0; chanIdx < 32; chanIdx++ ) {
			if( channelMap[ chanIdx ] < 0 ) continue;
			var panning = 7;
			if( stereoMode ) {
				panning = 12;
				if( moduleData.uByte( 64 + chanIdx ) < 8 ) panning = 3;
			}
			if( defaultPan ) {
				var panFlags = moduleData.uByte( moduleDataIdx + chanIdx );
				if( ( panFlags & 0x20 ) == 0x20 ) panning = panFlags & 0xF;
			}
			this.defaultPanning[ channelMap[ chanIdx ] ] = panning * 17;
		}
	}
	this.loadMod = function( moduleData ) {
		this.songName = moduleData.strLatin1( 0, 20 );
		this.sequenceLength = moduleData.uByte( 950 ) & 0x7F;
		this.restartPos = moduleData.uByte( 951 ) & 0x7F;
		if( this.restartPos >= this.sequenceLength ) this.restartPos = 0;
		this.sequence = new Int32Array( 128 );
		for( var seqIdx = 0; seqIdx < 128; seqIdx++ ) {
			var patIdx = moduleData.uByte( 952 + seqIdx ) & 0x7F;
			this.sequence[ seqIdx ] = patIdx;
			if( patIdx >= this.numPatterns ) this.numPatterns = patIdx + 1;
		}
		switch( moduleData.ubeShort( 1082 ) ) {
			case 0x4b2e: /* M.K. */
			case 0x4b21: /* M!K! */
			case 0x5434: /* FLT4 */
				this.numChannels = 4;
				this.c2Rate = 8287; /* PAL */
				this.gain = 64;
				break;
			case 0x484e: /* xCHN */
				this.numChannels = moduleData.uByte( 1080 ) - 48;
				this.c2Rate = 8363; /* NTSC */
				this.gain = 32;
				break;
			case 0x4348: /* xxCH */
				this.numChannels  = ( moduleData.uByte( 1080 ) - 48 ) * 10;
				this.numChannels += moduleData.uByte( 1081 ) - 48;
				this.c2Rate = 8363; /* NTSC */
				this.gain = 32;
				break;
			default:
				throw "MOD Format not recognised!";
		}
		this.defaultGVol = 64;
		this.defaultSpeed = 6;
		this.defaultTempo = 125;
		this.defaultPanning = new Int32Array( this.numChannels );
		for( var idx = 0; idx < this.numChannels; idx++ ) {
			this.defaultPanning[ idx ] = 51;
			if( ( idx & 3 ) == 1 || ( idx & 3 ) == 2 )
				this.defaultPanning[ idx ] = 204;
		}
		var moduleDataIdx = 1084;
		this.patterns = new Array( this.numPatterns );
		for( var patIdx = 0; patIdx < this.numPatterns; patIdx++ ) {
			var pattern = this.patterns[ patIdx ] = new IBXMPattern( this.numChannels, 64 );
			for( var patDataIdx = 0; patDataIdx < pattern.data.length; patDataIdx += 5 ) {
				var period = ( moduleData.uByte( moduleDataIdx ) & 0xF ) << 8;
				period = ( period | moduleData.uByte( moduleDataIdx + 1 ) ) * 4;
				if( period > 112 ) pattern.data[ patDataIdx ] = this.periodToKey( period );
				var ins = ( moduleData.uByte( moduleDataIdx + 2 ) & 0xF0 ) >> 4;
				ins = ins | moduleData.uByte( moduleDataIdx ) & 0x10;
				pattern.data[ patDataIdx + 1 ] = ins;
				var effect = moduleData.uByte( moduleDataIdx + 2 ) & 0x0F;
				var param  = moduleData.uByte( moduleDataIdx + 3 );
				if( param == 0 && ( effect < 3 || effect == 0xA ) ) effect = 0;
				if( param == 0 && ( effect == 5 || effect == 6 ) ) effect -= 2;
				if( effect == 8 && numChannels == 4 ) effect = param = 0;
				pattern.data[ patDataIdx + 3 ] = effect;
				pattern.data[ patDataIdx + 4 ] = param;
				moduleDataIdx += 4;
			}
		}
		this.numInstruments = 31;
		this.instruments = new Array( this.numInstruments + 1 );
		this.instruments[ 0 ] = new IBXMInstrument();
		for( var instIdx = 1; instIdx <= this.numInstruments; instIdx++ ) {
			var instrument = this.instruments[ instIdx ] = new IBXMInstrument();
			var sample = instrument.samples[ 0 ];
			instrument.name = moduleData.strLatin1( instIdx * 30 - 10, 22 );
			var sampleLength = moduleData.ubeShort( instIdx * 30 + 12 ) * 2;
			var fineTune = ( moduleData.uByte( instIdx * 30 + 14 ) & 0xF ) << 4;
			sample.fineTune = ( fineTune < 128 ) ? fineTune : fineTune - 256;
			var volume = moduleData.uByte( instIdx * 30 + 15 ) & 0x7F;
			sample.volume = ( volume <= 64 ) ? volume : 64;
			sample.panning = -1;
			sample.c2Rate = this.c2Rate;
			var loopStart = moduleData.ubeShort( instIdx * 30 + 16 ) * 2;
			var loopLength = moduleData.ubeShort( instIdx * 30 + 18 ) * 2;
			if( loopStart + loopLength > sampleLength )
				loopLength = sampleLength - loopStart;
			if( loopLength < 4 ) {
				loopStart = sampleLength;
				loopLength = 0;
			}
			sample.setSampleData( moduleData.samS8( moduleDataIdx, sampleLength ), loopStart, loopLength, false );
			moduleDataIdx += sampleLength;
		}
	}
	var data = new IBXMData( moduleData );
	if( data.strLatin1( 0, 17 ) == "Extended Module: " ) {
		this.loadXM( data );
	} else if( data.strLatin1( 44, 4 ) == "SCRM" ) {
		this.loadS3M( data );
	} else if( moduleData != undefined ) {
		this.loadMod( data );
	}
}