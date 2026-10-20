//#region src/model.ts
var e = [
	-8,
	-7,
	-6,
	-5,
	-4,
	-3,
	-2,
	-1,
	0
], t = [
	-56,
	-48,
	-40,
	-32,
	-24,
	-16,
	-8,
	0
].map((e) => Math.fround(e / 7)), n = 2 ** -4, r = 2 ** -16, i = .25, a = 16384, o = .5, s = 2 ** 15, c = [
	1 / 16,
	4 / 16,
	6 / 16,
	4 / 16,
	1 / 16
], l = 2 / 1.695, u = [
	"eigf",
	"avg-eigf",
	"guided",
	"avg-guided",
	"none"
], d = [
	"norm2",
	"mean",
	"lightness",
	"value",
	"norm1",
	"power",
	"geomean"
], f = {
	bands: [
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		0
	],
	curveSmoothing: 0,
	exposureBoost: 0,
	contrastBoost: 0,
	details: "eigf",
	estimator: "norm2",
	iterations: 1,
	blending: 5,
	feathering: 1
};
function p(e) {
	return Math.fround(Math.fround(Math.SQRT2) ** Math.fround(1 + e));
}
function m(e) {
	let t = e.details === "eigf" || e.details === "guided";
	return {
		exposure: 2 ** e.exposureBoost,
		fulcrum: t ? n : 0,
		contrast: t ? 2 ** e.contrastBoost : 1
	};
}
function h(e) {
	return e === "none" ? "none" : e === "guided" || e === "avg-guided" ? "guided" : "eigf";
}
function g(e) {
	return e === "avg-eigf" || e === "avg-guided";
}
function _(e, t) {
	return Math.trunc((Math.fround(Math.fround(e / 100) * t) - 1) / 2) | 0;
}
function v(e) {
	return l * Math.max(e, 1);
}
function y(e) {
	return 4 * (2 * (e < 4 ? 1 : Math.floor(e / 4)) + 1);
}
function b(e, t) {
	let n = _(t, a);
	switch (h(e)) {
		case "none": return 0;
		case "eigf": {
			let e = v(n);
			return Math.min(Math.max(1, Math.ceil(Math.log(3 * e * e + 1) / Math.log(4))), 14);
		}
		case "guided": return Math.min(Math.max(1, Math.ceil(Math.log2(y(n)))), 14);
	}
}
function x(e) {
	let t = b(e.details, e.blending);
	switch (h(e.details)) {
		case "none": return {
			eigf: 0,
			guided: 0
		};
		case "eigf": return {
			eigf: e.iterations * (t + 1),
			guided: 0
		};
		case "guided": return {
			eigf: 0,
			guided: e.iterations * (2 * t + 2)
		};
	}
}
//#endregion
//#region src/curve.ts
var S = Math.fround;
function C(e) {
	return S(S(2 * S(e)) * S(e));
}
function w(e, t) {
	return S(Math.exp(S(-S(S(e) * S(e)) / t)));
}
function T(n) {
	let r = C(n), i = /* @__PURE__ */ new Float32Array(72);
	for (let n = 0; n < 9; n++) for (let a = 0; a < 8; a++) i[n * 8 + a] = w(S(e[n] - t[a]), r);
	return i;
}
function ee(e, t, n, r) {
	if (n < r || r < 2 || n < 2) return null;
	let i = new Float64Array(r * r), a = new Float64Array(r);
	for (let o = 0; o < r; o++) {
		for (let t = 0; t <= o; t++) {
			let a = 0;
			for (let i = 0; i < n; i++) a += e[i * r + o] * e[i * r + t];
			i[o * r + t] = a;
		}
		let s = 0;
		for (let i = 0; i < n; i++) s += e[i * r + o] * t[i];
		a[o] = s;
	}
	if (!(i[0] > 0)) return null;
	let o = new Float64Array(r * r);
	for (let e = 0; e < r; e++) for (let t = 0; t <= e; t++) {
		let n = 0;
		for (let i = 0; i < t; i++) n += o[e * r + i] * o[t * r + i];
		if (e === t) {
			let a = i[e * r + e] - n;
			if (!(a >= 0)) return null;
			o[e * r + t] = Math.sqrt(a);
		} else {
			let a = o[t * r + t];
			if (!(a > 0)) return null;
			o[e * r + t] = (i[e * r + t] - n) / a;
		}
	}
	let s = new Float64Array(r);
	for (let e = 0; e < r; e++) {
		let t = a[e];
		for (let n = 0; n < e; n++) t -= o[e * r + n] * s[n];
		let n = o[e * r + e];
		if (!(n > 0)) return null;
		s[e] = t / n;
	}
	let c = new Float64Array(r);
	for (let e = r - 1; e >= 0; e--) {
		let t = s[e];
		for (let n = r - 1; n > e; n--) t -= o[n * r + e] * c[n];
		let n = o[e * r + e];
		if (!(n > 0)) return null;
		c[e] = t / n;
	}
	let l = Float32Array.from(c);
	return l.every(Number.isFinite) ? l : null;
}
function E(e, t) {
	let n = Float32Array.from(e, (e) => S(2 ** S(e))), r = ee(T(t), n, 9, 8);
	return r ? {
		weights: Array.from(r),
		sigma: t,
		valid: !0
	} : {
		weights: Array(8).fill(0),
		sigma: t,
		valid: !1
	};
}
function D(e, n) {
	let r = C(n.sigma), a = S(Math.min(Math.max(e, -8), 0)), o = 0;
	for (let e = 0; e < 8; e++) o = S(o + S(w(S(a - t[e]), r) * n.weights[e]));
	return Math.min(Math.max(o, i), 4);
}
function O(t) {
	return e.map((e) => D(e, t));
}
function te(t, n, r, i) {
	let a = C(S(S(S(n) * S(n)) / 2)), o = Float32Array.from(t, (t, n) => S(S(2 ** S(t)) * S(2 ** S(w(S(e[n] - S(r)), a) * S(i))))), s = ee(T(n), o, 9, 8);
	return s ? O({
		weights: Array.from(s),
		sigma: n
	}).map((e) => S(Math.log2(e))) : null;
}
function ne(e) {
	let t = /* @__PURE__ */ new Float64Array(256);
	for (let n = 0; n < 256; n++) t[n] = Math.log2(D(8 * n / 255 - 8, e));
	return t;
}
//#endregion
//#region src/measure.ts
var k = Math.fround, A = 512, re = (e) => k(16 * k(e) / k(A - 1) - 10);
function ie(e) {
	let t = new Int32Array(A), n = 0;
	for (let r = 0; r < e.length; r++) {
		let i = e[r];
		if (!Number.isFinite(i)) continue;
		let a = Math.trunc(k(k(k(i + 10) / 16) * A));
		t[Math.min(Math.max(a, 0), A - 1)]++, n++;
	}
	if (n === 0) return null;
	let r = Math.trunc(k(k(n) * k(.05))), i = Math.trunc(k(k(n) * k(1 - k(.95)))), a = 0, o = 0;
	for (let e = 0; e < A; e++) {
		let n = a;
		if (a += t[e], n < r && r <= a) {
			o = e;
			break;
		}
	}
	a = 0;
	let s = 0;
	for (let e = A - 1; e >= 0; e--) {
		let n = a;
		if (a += t[e], n < i && i <= a) {
			s = e;
			break;
		}
	}
	let c = /* @__PURE__ */ new Int32Array(256), l = 1;
	for (let e = 0; e < A; e++) {
		let n = re(e), r = Math.min(Math.max(Math.trunc(k(k(k(n + 8) / 8) * 256)), 0), 255);
		c[r] += t[e], c[r] > l && (l = c[r]);
	}
	return {
		bins: c,
		max: l,
		first: re(o),
		last: re(s),
		count: n
	};
}
function ae(e, t, r, i) {
	let a = k(2 ** k(r)), o = k(2 ** k(i)), s = (e) => k(k(k(k(k(2 ** k(e)) - n) / o) + n) / a), c = s(e), l = s(t), u = k(n - k(2 ** -7)), d = k(k(2 ** -1) - n);
	return {
		fd: c,
		ld: l,
		s1: u,
		s2: d,
		c: o,
		mix: k(k(c * d) + k(l * u))
	};
}
function oe(e, t, r, i) {
	let { s1: a, s2: o, mix: s } = ae(e, t, r, i);
	return k(Math.log2(k(k(n * k(a + o)) / s)));
}
function se(e, t, r) {
	let { fd: i, ld: a, c: o, mix: s } = ae(e, t, r.exposureBoost, r.contrastBoost), c = k(Math.log2(k(k(s / k(n * k(a - i))) / o))), l = k(r.feathering);
	if (r.details === "eigf" && c > 0) {
		let e = k(k(-.0276) + .01823 * l + k(k(k(.7566) - 1) * c));
		l < 5 ? c = k(c + e) : l < 10 && (c = k(c + k(e * k(2 - k(l / 5)))));
	} else r.details === "guided" && c > 0 && (c = k(k(.0235) + k(k(1.1225) * c)));
	return k(k(r.contrastBoost) + c);
}
var ce = [
	[
		.076555024,
		.124401914,
		.076555024
	],
	[
		.124401914,
		.196172249,
		.124401914
	],
	[
		.076555024,
		.124401914,
		.076555024
	]
];
function le(e, t, n, r, i) {
	if (r < 0 || i < 0 || r >= t || i >= n) return null;
	let a = 0;
	for (let o = 0; o < 3; o++) {
		let s = Math.min(Math.max(i - 1 + o, 0), n - 1);
		for (let n = 0; n < 3; n++) {
			let i = Math.min(Math.max(r - 1 + n, 0), t - 1), c = e[s * t + i];
			if (!Number.isFinite(c)) return null;
			a += 2 ** c * ce[o][n];
		}
	}
	return Math.log2(a);
}
//#endregion
//#region src/overlay-model.ts
var ue = .25, de = .1;
function fe(e) {
	return e.shiftKey ? 1 : e.altKey ? de : ue;
}
function pe(e) {
	let t = e.deltaY === 0 ? e.deltaX : e.deltaY, n = e.deltaMode === 1 ? t * 16 : e.deltaMode === 2 ? t * 120 : t;
	return n === 0 ? 0 : -n;
}
var me = 100, he = 33;
function ge() {
	let e = 0;
	return {
		push(t) {
			let n = pe(t);
			if (Math.abs(n) >= he) return e = 0, Math.sign(n) * Math.max(1, Math.round(Math.abs(n) / me));
			(n > 0 && e < 0 || n < 0 && e > 0) && (e = 0), e += n;
			let r = Math.trunc(e / me) || 0;
			return e -= r * me, r;
		},
		reset() {
			e = 0;
		}
	};
}
function _e(e) {
	if (e === null || !Number.isFinite(e)) return "? EV";
	let t = Math.round(e * 10) / 10;
	return `${t >= 0 ? "+" : "−"}${Math.abs(t).toFixed(1)} EV`;
}
var ve = (e) => Math.min(Math.max(e, 0), 1) ** (1 / 2.2);
function ye(e) {
	let t = Math.round(255 * ve(e));
	return `rgb(${t}, ${t}, ${t})`;
}
function be(e) {
	return ve(e) > .5 ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
}
function xe(e) {
	return Math.min(Math.max(.5 * e, -1), 1) * (Math.PI / 2);
}
var j = (e) => (Math.abs(e) < .005 ? 0 : e).toFixed(2);
function Se(e, t) {
	return e === null || !t.valid ? 0 : Math.log2(D(e, t));
}
var Ce = 4, we = 1.5, Te = .9, Ee = .8;
function De(e, t) {
	return [
		{
			x1: e + 16,
			y1: t,
			x2: e + 16 + 8,
			y2: t
		},
		{
			x1: e - 16,
			y1: t,
			x2: e - 32 - 16,
			y2: t
		},
		{
			x1: e,
			y1: t + 16,
			x2: e,
			y2: t + 36
		},
		{
			x1: e,
			y1: t - 16,
			x2: e,
			y2: t - 36
		}
	];
}
function Oe(e, t, n, r) {
	let i = e + 16 + 8, a = r + 8;
	return {
		x: i,
		y: t - a / 2,
		width: n + 8,
		height: a,
		textX: i + Ce,
		textY: t
	};
}
function ke(e, t, n, r) {
	if (r === 0) return "";
	let i = e + n * Math.cos(Math.PI + r), a = t + n * Math.sin(Math.PI + r);
	return `M ${j(e - n)} ${j(t)} A ${n} ${n} 0 0 ${+(r > 0)} ${j(i)} ${j(a)}`;
}
function Ae(e, t, n, r, i) {
	if (!i || i.w <= 0 || i.h <= 0) return null;
	let a = ((e - n.left) * r - i.x) / i.w, o = ((t - n.top) * r - i.y) / i.h;
	return a < 0 || a >= 1 || o < 0 || o >= 1 ? null : {
		x: a,
		y: o
	};
}
//#endregion
//#region src/params.ts
var je = "tone-equalizer", Me = `${je}.correction`, Ne = `${je}.mask-view`, Pe = "toneEqualizerMask", Fe = [
	"b0",
	"b1",
	"b2",
	"b3",
	"b4",
	"b5",
	"b6",
	"b7",
	"b8"
], Ie = [
	...Fe,
	"smoothing",
	"exposureBoost",
	"contrastBoost",
	"details",
	"estimator",
	"diffusion",
	"diameter",
	"feathering"
], Le = [
	"on",
	"w0",
	"w1",
	"gDenom",
	"fMode",
	"fAverage",
	"fIterations",
	"fLevels",
	"fDrawsEigf",
	"fDrawsGuided",
	"fDiameter",
	"fEps",
	"fExposure",
	"fFulcrum",
	"fContrast",
	"fNorm"
];
function M(e) {
	return `${Me}.${e}`;
}
var Re = M("probe"), ze = `${Ne}.mode`, N = {
	band: {
		min: -2,
		max: 2
	},
	smoothing: {
		min: -2.33,
		max: 1.67
	},
	boost: {
		min: -16,
		max: 16
	},
	iterations: {
		min: 1,
		max: 20
	},
	blending: {
		min: .01,
		max: 100
	},
	feathering: {
		min: .01,
		max: 1e4
	}
}, P = (e, t) => Math.min(Math.max(e, t.min), t.max);
function F(e, t) {
	let n = e[M(t)];
	return typeof n == "number" && Number.isFinite(n) ? n : null;
}
function Be(e, t, n) {
	let r = F(e, t);
	return r !== null && Number.isInteger(r) && r >= 0 && r < n.length ? n[r] : n[0];
}
function I(e) {
	let t = (t, n, r) => P(n + (F(e, t) ?? 0), r);
	return {
		bands: Fe.map((t) => P(F(e, t) ?? 0, N.band)),
		curveSmoothing: P(F(e, "smoothing") ?? 0, N.smoothing),
		exposureBoost: P(F(e, "exposureBoost") ?? 0, N.boost),
		contrastBoost: P(F(e, "contrastBoost") ?? 0, N.boost),
		details: Be(e, "details", u),
		estimator: Be(e, "estimator", d),
		iterations: Math.round(t("diffusion", f.iterations, N.iterations)),
		blending: t("diameter", f.blending, N.blending),
		feathering: t("feathering", f.feathering, N.feathering)
	};
}
function Ve(e) {
	let t = {};
	return Fe.forEach((n, r) => {
		t[M(n)] = e.bands[r];
	}), t[M("smoothing")] = e.curveSmoothing, t[M("exposureBoost")] = e.exposureBoost, t[M("contrastBoost")] = e.contrastBoost, t[M("details")] = u.indexOf(e.details), t[M("estimator")] = d.indexOf(e.estimator), t[M("diffusion")] = e.iterations - f.iterations, t[M("diameter")] = e.blending - f.blending, t[M("feathering")] = e.feathering - f.feathering, t;
}
function He(e) {
	let t = h(e.details), n = m(e), r = x(e);
	return {
		[M("fMode")]: t === "none" ? 0 : t === "guided" ? 1 : 2,
		[M("fAverage")]: +!!g(e.details),
		[M("fIterations")]: e.iterations,
		[M("fLevels")]: b(e.details, e.blending),
		[M("fDrawsEigf")]: r.eigf,
		[M("fDrawsGuided")]: r.guided,
		[M("fDiameter")]: e.blending / 100,
		[M("fEps")]: 1 / e.feathering,
		[M("fExposure")]: n.exposure,
		[M("fFulcrum")]: n.fulcrum,
		[M("fContrast")]: n.contrast,
		[M("fNorm")]: d.indexOf(e.estimator)
	};
}
function Ue(e) {
	return {
		[M("on")]: 1,
		[M("w0")]: e.weights.slice(0, 4),
		[M("w1")]: e.weights.slice(4, 8),
		[M("gDenom")]: 1 / (2 * e.sigma * e.sigma)
	};
}
function We() {
	let e = {};
	for (let t of Le) e[M(t)] = t === "w0" || t === "w1" ? [
		0,
		0,
		0,
		0
	] : 0;
	return e;
}
function L(e) {
	return E(e.bands, p(e.curveSmoothing));
}
function Ge(e, t = L(e)) {
	return e.bands.some((e) => e !== 0) && t.valid;
}
function Ke(e) {
	let t = Ve(I(Ve(e)));
	return {
		edit: t,
		read: I(t)
	};
}
function R(e) {
	let { edit: t, read: n } = Ke(e), r = L(n);
	return {
		...t,
		...Ge(n, r) ? {
			...He(n),
			...Ue(r)
		} : We()
	};
}
function qe() {
	return R(f);
}
var Je = (e, t) => Array.isArray(t) ? Array.isArray(e) && e.length === t.length && e.every((e, n) => e === t[n]) : e === t;
function Ye(e) {
	if (!Ie.some((t) => M(t) in e)) return null;
	let t = R(I(e));
	return Object.entries(t).every(([t, n]) => Je(e[t], n)) ? null : t;
}
function Xe(e) {
	return {
		...He(Ke(e).read),
		[Re]: 1
	};
}
//#endregion
//#region src/runtime.ts
var Ze = null;
function Qe(e) {
	Ze = e;
}
function z() {
	if (!Ze) throw Error("[tone-equalizer] api() called before activate()");
	return Ze;
}
function B(e, t, ...n) {
	return z().react.createElement(e, t, ...n);
}
//#endregion
//#region src/schedule.ts
function $e(e, t) {
	let n = !1, r = !1, i = !1, a = null, o = -Infinity, s = () => {
		a = null, !n && (r = !0, o = Date.now(), e().catch(() => void 0).finally(() => {
			r = !1, i && !n && (i = !1, c());
		}));
	}, c = () => {
		if (!n) {
			if (r) {
				i = !0;
				return;
			}
			a === null && (a = setTimeout(s, Math.max(0, t - (Date.now() - o))));
		}
	};
	return {
		request: c,
		stop() {
			n = !0, i = !1, a !== null && clearTimeout(a), a = null;
		}
	};
}
//#endregion
//#region src/store.ts
var et = null;
function tt() {
	et = z().stores.create((e) => ({
		probe: null,
		cursor: null,
		adjusting: !1,
		showMask: !1,
		unstable: !1,
		setProbe: (t) => e({ probe: t }),
		setCursor: (t) => e({ cursor: t }),
		setAdjusting: (t) => e(t ? { adjusting: t } : {
			adjusting: t,
			cursor: null
		}),
		setShowMask: (t) => e({ showMask: t }),
		setUnstable: (t) => e({ unstable: t })
	}));
}
function V() {
	if (!et) throw Error("[tone-equalizer] store() called before activate()");
	return et;
}
function nt(e, t, n) {
	let r = new Float32Array(t * n);
	for (let i = 0; i < t * n; i++) {
		let t = 4 * i;
		r[i] = e[t + 2] < 128 ? NaN : -16 + 24 * (e[t] * 256 + e[t + 1]) / 65535;
	}
	return r;
}
function rt(e) {
	return {
		...e,
		...Xe(I(e)),
		[ze]: 2
	};
}
function it(e) {
	return {
		...Xe(I(e)),
		[ze]: 1
	};
}
var H = null;
function at(e) {
	let { width: t, height: n } = e;
	if (t < 2 || n < 2) return null;
	H ||= new OffscreenCanvas(t, n), H.width !== t && (H.width = t), H.height !== n && (H.height = n);
	let r = H.getContext("2d", { willReadFrequently: !0 });
	return r ? (r.clearRect(0, 0, t, n), r.drawImage(e, 0, 0), {
		data: r.getImageData(0, 0, t, n).data,
		width: t,
		height: n
	}) : null;
}
function ot(e, t) {
	let n = nt(e.data, e.width, e.height);
	return {
		width: e.width,
		height: e.height,
		ev: n,
		histogram: ie(n),
		signature: t
	};
}
var U = (e) => e.previewParamBag ?? e.paramBag, st = (e) => JSON.stringify(Xe(I(e)));
function ct(e) {
	return JSON.stringify(e, (e, t) => typeof t == "object" && t && !Array.isArray(t) ? Object.fromEntries(Object.entries(t).sort(([e], [t]) => e < t ? -1 : +(e > t))) : t);
}
var lt = /* @__PURE__ */ new WeakMap();
function ut(e) {
	let t = lt.get(e);
	return t === void 0 && (t = ct(e), lt.set(e, t)), t;
}
var dt = `${Me}.`;
function W(e) {
	let t = U(e), n = {};
	for (let [e, r] of Object.entries(t)) !e.startsWith(dt) && e !== ze && (n[e] = r);
	return JSON.stringify([
		e.photoId,
		ut(e.previewParams ?? e.params),
		ct(n),
		st(t)
	]);
}
function ft(e, t) {
	let n = U(e), r = U(t);
	return n !== r && st(n) !== st(r);
}
var pt = (e) => e instanceof Error ? e.message : String(e);
function mt(e) {
	let t = !1, n = null, r = (e, t) => {
		n !== e && (n = e, console.warn(`[tone-equalizer] ${t}`));
	}, i = $e(async () => {
		let i = e.develop.getState(), a = i.photoId;
		if (!a) return;
		let o = W(i), s = null, c = null;
		try {
			s = await e.render(a, i.previewParams ?? i.params, rt(U(i))), s || (c = `no exposure reading yet for photo ${a}: the host returned no frame (expected while a RAW is still decoding)`);
		} catch (e) {
			s = null, c = `no exposure reading for photo ${a}: the render threw: ${pt(e)}`;
		}
		let l = !t && e.develop.getState().photoId === a, u = null;
		try {
			let t = s && l ? e.readback(s) : null;
			u = t ? ot(t, o) : null, s && l && !t && (c = `no exposure reading for photo ${a}: the frame read back blank`);
		} catch (e) {
			u = null, c = `no exposure reading for photo ${a}: reading the frame back threw: ${pt(e)}`;
		} finally {
			s?.close();
		}
		l && (u && n === a && (n = null), !u && c && r(a, c), e.publish(u));
	}, e.throttleMs ?? 150), a = e.develop.subscribe((t, r) => {
		if (!t.photoId) {
			r.photoId && e.publish(null);
			return;
		}
		t.photoId !== r.photoId && (n = null, e.publish(null)), (t.photoId !== r.photoId || t.histogram !== r.histogram || ft(r, t)) && i.request();
	});
	return i.request(), () => {
		t = !0, i.stop(), a(), e.publish(null);
	};
}
function ht() {
	let e = z();
	return mt({
		develop: e.stores.useDevelopStore,
		render: (t, n, r) => e.develop.renderPhotoFrame(t, n, r, { lossless: !0 }),
		readback: at,
		publish: (e) => V().getState().setProbe(e)
	});
}
var gt = "Tone Equalizer scroll", _t = "tone-equalizer-hatch", vt = 10, yt = 6;
function bt(e) {
	let t = z().react.useMemo(() => L(I(e.paramBag)), [e.paramBag]), { x: n, y: r } = e.cursor.local, i = e.cursor.ev, a = i === null ? 0 : 2 ** i, o = Se(i, t), s = a * 2 ** o, c = be(s), l = (e, t) => B("line", {
		key: t,
		...e,
		style: {
			stroke: c,
			strokeWidth: we
		}
	}), u = (e, t, i) => [
		B("circle", {
			key: i,
			cx: n,
			cy: r,
			r: e,
			style: {
				fill: ye(t),
				fillOpacity: Te
			}
		}),
		t > 1 ? B("circle", {
			key: `${i}-hatch`,
			cx: n,
			cy: r,
			r: e,
			style: { fill: `url(#${_t})` }
		}) : null,
		B("circle", {
			key: `${i}-outline`,
			cx: n,
			cy: r,
			r: e,
			style: {
				fill: "none",
				stroke: c,
				strokeWidth: 1
			}
		})
	], d = _e(i), f = Oe(n, r, yt * d.length, vt);
	return B("svg", { style: {
		position: "absolute",
		left: 0,
		top: 0,
		width: "100%",
		height: "100%",
		overflow: "visible",
		pointerEvents: "none"
	} }, B("defs", null, B("pattern", {
		id: _t,
		width: 4,
		height: 4,
		patternUnits: "userSpaceOnUse",
		patternTransform: "rotate(45)"
	}, B("line", {
		x1: 0,
		y1: 0,
		x2: 0,
		y2: 4,
		style: {
			stroke: c,
			strokeWidth: 1
		}
	}))), B("path", {
		d: ke(n, r, 32, xe(o)),
		style: {
			fill: "none",
			stroke: c,
			strokeWidth: 8
		}
	}), ...De(n, r).map(l), ...u(16, a, "before"), ...u(8, s, "after"), B("rect", {
		x: f.x,
		y: f.y,
		width: f.width,
		height: f.height,
		style: { fill: `rgba(0, 0, 0, ${Ee})` }
	}), B("text", {
		x: f.textX,
		y: f.textY,
		style: {
			fill: "rgb(255, 255, 255)",
			fontSize: vt,
			fontFamily: "sans-serif",
			dominantBaseline: "central"
		}
	}, d));
}
function xt() {
	let { useEffect: e, useRef: t, useState: n } = z().react, r = V()((e) => e.adjusting), i = V()((e) => e.cursor), a = z().stores.useDevelopStore, o = a((e) => e.paramBag), s = z().develop.useDevelopOverlay(), c = t(null), [l, u] = n(!1), [d] = n(ge), f = t(null), m = t(!1);
	e(() => {
		if (!r) return;
		let e = /* @__PURE__ */ new Set(), t = () => u(e.has("Control") || e.has("Meta") || e.has(" ")), n = (n) => {
			if (n.key === "Escape") {
				n.defaultPrevented || V().getState().setAdjusting(!1);
				return;
			}
			e.add(n.key), t();
		}, i = (n) => {
			e.delete(n.key), t();
		}, a = () => {
			e.clear(), t();
		};
		return window.addEventListener("keydown", n), window.addEventListener("keyup", i), window.addEventListener("blur", a), () => {
			window.removeEventListener("keydown", n), window.removeEventListener("keyup", i), window.removeEventListener("blur", a), u(!1);
		};
	}, [r]);
	let h = () => {
		f.current = null, d.reset(), m.current && (m.current = !1, a.getState().commitEdit(gt));
	}, g = () => {
		f.current !== null && clearTimeout(f.current), f.current = setTimeout(h, 400);
	}, _ = () => {
		f.current !== null && (clearTimeout(f.current), h());
	};
	e(() => _, []);
	let v = (e, t) => {
		let n = I(a.getState().paramBag), r = te(n.bands, p(n.curveSmoothing), e, t);
		return V().getState().setUnstable(r === null), r ? (a.getState().setDynParams(R({
			...n,
			bands: r
		})), m.current = !0, !0) : !1;
	};
	return e(() => {
		let e = c.current;
		if (!e || !r) return;
		let t = (e) => {
			if (e.ctrlKey || e.metaKey) return;
			let t = V().getState().cursor;
			if (!t || t.ev === null || e.deltaX === 0 && e.deltaY === 0) return;
			e.preventDefault(), e.stopPropagation(), g();
			let n = d.push(e), r = Math.sign(n) * fe(e);
			for (let e = 0; e < Math.abs(n) && v(t.ev, r); e++);
		};
		return e.addEventListener("wheel", t, { passive: !1 }), () => e.removeEventListener("wheel", t);
	}, [r]), r ? B("div", {
		ref: c,
		"data-testid": "te-adjust",
		style: {
			position: "absolute",
			inset: 0,
			pointerEvents: l ? "none" : "auto",
			cursor: i ? "none" : z().cursors.resolve("crosshair")
		},
		onPointerMove: (e) => {
			let t = e.currentTarget, n = t.getBoundingClientRect(), r = n.width > 0 && t.clientWidth > 0 ? t.clientWidth / n.width : 1, i = s.imageRect, a = Ae(e.clientX, e.clientY, n, r, i);
			if (i && !a) {
				V().getState().setCursor(null);
				return;
			}
			let o = V().getState().probe, c = a && o ? le(o.ev, o.width, o.height, Math.min(o.width - 1, Math.floor(a.x * o.width)), Math.min(o.height - 1, Math.floor(a.y * o.height))) : null;
			V().getState().setCursor({
				ev: c,
				local: {
					x: (e.clientX - n.left) * r,
					y: (e.clientY - n.top) * r
				}
			});
		},
		onPointerLeave: () => V().getState().setCursor(null)
	}, i ? B(bt, {
		cursor: i,
		paramBag: o
	}) : null) : null;
}
function St() {
	let { useEffect: e, useRef: t, useState: n } = z().react, r = V()((e) => e.showMask), i = z().develop.useDevelopOverlay(), a = z().stores.useDevelopStore, o = a((e) => r ? W(e) : ""), s = t(null), c = t(null), l = t(i.nonce), u = t(null), [d, f] = n(null);
	l.current = i.nonce, e(() => {
		if (!r) {
			u.current?.close(), u.current = null, f(null);
			return;
		}
		let e = !0, t = $e(async () => {
			let t = l.current, n = a.getState(), r = await z().develop.captureFrame(n.previewParams ?? n.params, {
				asShown: !0,
				paramBag: it(U(n))
			});
			if (!e) {
				r.close();
				return;
			}
			u.current?.close(), u.current = r, f({
				bitmap: r,
				nonce: t
			});
		}, 150);
		return c.current = t, t.request(), () => {
			e = !1, t.stop(), c.current = null;
		};
	}, [r]), e(() => {
		c.current?.request();
	}, [o, i.nonce]), e(() => () => {
		u.current?.close(), u.current = null;
	}, []);
	let p = r && d !== null && d.nonce === i.nonce && i.rect !== null;
	return e(() => {
		let e = s.current;
		e && d && p && (e.width = d.bitmap.width, e.height = d.bitmap.height, e.getContext("2d")?.drawImage(d.bitmap, 0, 0));
	}, [d, p]), !p || !i.rect ? null : B("canvas", {
		ref: s,
		"data-testid": "te-mask",
		style: {
			position: "absolute",
			left: i.rect.x,
			top: i.rect.y,
			width: i.rect.w,
			height: i.rect.h,
			pointerEvents: "none"
		}
	});
}
function Ct() {
	return B("div", { style: {
		position: "absolute",
		inset: 0,
		pointerEvents: "none"
	} }, B(St, null), B(xt, null));
}
//#endregion
//#region src/graph-model.ts
var G = {
	left: 6,
	right: 22,
	top: 14,
	bottom: 6
}, wt = 8;
function Tt(e) {
	return Math.round(Math.min(Math.max(.75 * e, 160), 280));
}
function Et(e, t) {
	return {
		x: G.left,
		y: G.top,
		w: Math.max(1, e - G.left - G.right),
		h: Math.max(1, t - G.top - G.bottom)
	};
}
function Dt(e, t) {
	return t.x + (e - -8) / wt * t.w;
}
function Ot(e, t) {
	return -8 + (e - t.x) / t.w * wt;
}
function K(e, t) {
	return t.y + (.5 - e / 4) * t.h;
}
function kt(e, t, n) {
	return {
		x0: Ot(e.x, n),
		offset: (e.y - t.y) / n.h * 4
	};
}
function At(t, n) {
	let r = n.w / (e.length - 1), i = Math.round((t - n.x) / r) + 0;
	return i < 0 || i >= e.length ? null : Math.abs(t - (n.x + i * r)) <= .45 * r ? i : null;
}
function jt(t) {
	let n = Math.round(t - -8) + 0;
	return n < 0 || n >= e.length ? null : Math.abs(t - e[n]) <= .45 ? n : null;
}
function Mt(e, t) {
	return e / Math.SQRT2 / wt * t.w;
}
function Nt(e, t) {
	return Array.from(e.bins, (n) => n / e.max * .96 * t.h);
}
function Pt(e) {
	return {
		highlights: e.last > -.1,
		shadows: e.first < -7.9
	};
}
function Ft(e, t) {
	return {
		x: Dt(Math.min(Math.max(e, -8), 0), t),
		outside: e < -8 || e > 0
	};
}
//#endregion
//#region src/Graph.ts
var It = "rgb(191, 128, 0)";
function Lt(e) {
	let t = getComputedStyle(e).backgroundColor.match(/\d+(?:\.\d+)?/g);
	return !t || (Number(t[0]) + Number(t[1]) + Number(t[2])) / 765 < .5 ? {
		fg: "rgba(235, 235, 235, 0.92)",
		faint: "rgba(235, 235, 235, 0.2)",
		fill: "rgba(235, 235, 235, 0.16)"
	} : {
		fg: "rgba(25, 25, 25, 0.9)",
		faint: "rgba(25, 25, 25, 0.2)",
		fill: "rgba(25, 25, 25, 0.14)"
	};
}
var Rt = (e) => e === 0 ? "+0" : `−${-e}`, zt = (e) => e > 0 ? `+${e}` : e < 0 ? `−${-e}` : "0";
function Bt(e, t, n) {
	e.beginPath(), e.moveTo(t, n - 4), e.lineTo(t + 4, n + 3), e.lineTo(t - 4, n + 3), e.closePath(), e.fill();
}
function Vt(t, n, r, i, a) {
	let o = Et(n, r), s = (e, n, r, i) => {
		t.beginPath(), t.moveTo(e, n), t.lineTo(r, i), t.stroke();
	};
	t.clearRect(0, 0, n, r), t.font = "9px sans-serif", t.strokeStyle = i.faint, t.lineWidth = 1;
	for (let e = 0; e <= 8; e++) s(o.x + e / 8 * o.w, o.y, o.x + e / 8 * o.w, o.y + o.h), s(o.x, o.y + e / 8 * o.h, o.x + o.w, o.y + e / 8 * o.h);
	t.fillStyle = i.fg, t.textAlign = "center", t.textBaseline = "bottom";
	for (let n of e) t.fillText(Rt(n), Dt(n, o), o.y - 2);
	t.textAlign = "left", t.textBaseline = "middle";
	for (let e of [
		2,
		1,
		0,
		-1,
		-2
	]) t.fillText(zt(e), o.x + o.w + 3, K(e, o));
	if (a.histogram) {
		let e = Nt(a.histogram, o), n = o.y + o.h;
		t.fillStyle = i.fill, t.beginPath(), t.moveTo(o.x, n), e.forEach((r, i) => t.lineTo(o.x + i / (e.length - 1) * o.w, n - r)), t.lineTo(o.x + o.w, n), t.closePath(), t.fill();
		let r = Pt(a.histogram);
		t.fillStyle = It, r.highlights && Bt(t, o.x + o.w - 8, o.y + 8), r.shadows && Bt(t, o.x + 8, o.y + 8);
	}
	t.strokeStyle = i.fg, t.globalAlpha = .5, s(o.x, K(0, o), o.x + o.w, K(0, o)), t.globalAlpha = 1;
	let c = ne(a.fit);
	t.strokeStyle = a.unstable || !a.fit.valid ? It : i.fg, t.lineWidth = 1.5, t.beginPath(), c.forEach((e, n) => {
		let r = o.x + n / (c.length - 1) * o.w;
		n === 0 ? t.moveTo(r, K(e, o)) : t.lineTo(r, K(e, o));
	}), t.stroke();
	let l = a.hoverNode ?? (a.cursorEv === null ? null : jt(a.cursorEv));
	if (t.fillStyle = i.fg, t.strokeStyle = i.fg, O(a.fit).forEach((n, r) => {
		let i = Dt(e[r], o), a = K(Math.log2(n), o);
		t.lineWidth = 6, t.globalAlpha = .3, s(i, K(0, o), i, a), t.globalAlpha = 1, t.lineWidth = 1.5, t.beginPath(), t.arc(i, a, 4, 0, 2 * Math.PI), r === l ? t.fill() : t.stroke();
	}), a.mouseX !== null) {
		let e = Ot(a.mouseX, o);
		t.lineWidth = 1, t.beginPath(), t.arc(a.mouseX, K(Math.log2(D(e, a.fit)), o), Mt(a.fit.sigma, o), 0, 2 * Math.PI), t.stroke();
	}
	if (a.cursorEv !== null) {
		let e = Ft(a.cursorEv, o);
		t.strokeStyle = e.outside ? It : i.fg, t.lineWidth = e.outside ? 3 : 1, s(e.x, o.y, e.x, o.y + o.h);
	}
}
function Ht() {
	let { useEffect: e, useLayoutEffect: t, useRef: n, useState: r } = z().react, i = z().stores.useDevelopStore, a = i((e) => e.paramBag), o = V()((e) => e.probe?.histogram ?? null), s = V()((e) => e.cursor?.ev ?? null), c = V()((e) => e.unstable), [l, u] = r(240), [d, m] = r(null), [h, g] = r(null), [_, v] = r(0), y = n(null), b = n(null), x = n(null), S = n(null), C = Tt(l);
	e(() => {
		let e = y.current;
		if (!e || typeof ResizeObserver > "u") return;
		let t = new ResizeObserver((e) => {
			let t = Math.round(e[0].contentRect.width);
			t > 40 && u(t);
		});
		return t.observe(e), () => t.disconnect();
	}, []), e(() => {
		let e = new MutationObserver(() => v((e) => e + 1));
		return e.observe(document.documentElement, { attributes: !0 }), e.observe(document.body, { attributes: !0 }), () => e.disconnect();
	}, []), t(() => {
		let e = b.current;
		if (!e) return;
		let t = window.devicePixelRatio || 1, n = Math.round(l * t), r = Math.round(C * t);
		e.width !== n && (e.width = n), e.height !== r && (e.height = r);
		let i = e.getContext("2d");
		i && (i.setTransform(t, 0, 0, t, 0, 0), S.current?.epoch !== _ && (S.current = {
			epoch: _,
			ink: Lt(e)
		}), Vt(i, l, C, S.current.ink, {
			fit: L(I(a)),
			histogram: o,
			hoverNode: d,
			mouseX: h,
			cursorEv: s,
			unstable: c
		}));
	}, [
		a,
		o,
		s,
		c,
		d,
		h,
		l,
		C,
		_
	]);
	let w = (e) => {
		let t = e.currentTarget.getBoundingClientRect();
		return {
			x: t.width > 0 ? (e.clientX - t.left) * l / t.width : 0,
			y: t.height > 0 ? (e.clientY - t.top) * C / t.height : 0
		};
	}, T = (e) => {
		e.button === 0 && (e.currentTarget.setPointerCapture?.(e.pointerId), x.current = {
			...w(e),
			moved: !1
		});
	}, ee = (e) => {
		let t = w(e), n = Et(l, C);
		g(t.x), m(At(t.x, n));
		let r = x.current;
		if (!r) return;
		let a = kt(r, t, n), o = I(i.getState().paramBag), s = te(o.bands, p(o.curveSmoothing), a.x0, a.offset);
		s && i.getState().setDynParams(R({
			...o,
			bands: s
		})), V().getState().setUnstable(s === null), x.current = {
			x: t.x,
			y: t.y,
			moved: r.moved || s !== null
		};
	}, E = () => {
		let e = x.current;
		x.current = null, e?.moved && i.getState().commitEdit("Tone Equalizer curve");
	};
	return B("div", {
		ref: y,
		style: { width: "100%" }
	}, B("canvas", {
		ref: b,
		role: "img",
		"aria-label": "Tone equalizer curve",
		title: "Drag to shape the curve; double-click to reset it",
		style: {
			width: "100%",
			height: C,
			display: "block",
			borderRadius: 3,
			background: z().ui.tokens.surface0 ?? "var(--color-surface-0)",
			touchAction: "none",
			cursor: "crosshair"
		},
		onPointerDown: T,
		onPointerMove: ee,
		onPointerUp: E,
		onLostPointerCapture: E,
		onPointerLeave: () => {
			g(null), m(null);
		},
		onDoubleClick: () => {
			i.getState().setDynParams(R({
				...I(i.getState().paramBag),
				bands: f.bands
			})), V().getState().setUnstable(!1), i.getState().commitEdit("Tone Equalizer reset curve");
		}
	}));
}
//#endregion
//#region src/presets.ts
var q = Math.fround;
function Ut(e) {
	let t = q(e), n = q(q(5 / 3) * t);
	return [
		t,
		n,
		n,
		t,
		0,
		-t,
		-n,
		-n,
		-t
	];
}
function Wt(e) {
	let t = q(e), n = (e) => q(q(e / 9) * t);
	return [
		-n(15),
		-n(14),
		-n(12),
		-n(8),
		0,
		n(8),
		n(12),
		n(14),
		n(15)
	];
}
var Gt = [
	0,
	.15,
	.6,
	1.15,
	1.33,
	1.15,
	.6,
	.15,
	0
], J = (e, t) => ({
	name: e,
	params: {
		...f,
		...t
	}
}), Y = (e, t, n, r, i) => ({
	details: e,
	estimator: "norm2",
	exposureBoost: -1.57,
	blending: t,
	feathering: n,
	iterations: r,
	bands: Ut(i)
}), Kt = (e) => ({
	details: "none",
	estimator: "norm2",
	exposureBoost: -1.57,
	blending: 5,
	feathering: 500,
	iterations: 1,
	bands: Wt(e)
}), qt = [
	J("Simple tone curve", {
		details: "none",
		estimator: "power",
		exposureBoost: -.5
	}),
	J("Mask blending | all purposes", {
		details: "eigf",
		estimator: "norm2"
	}),
	J("Mask blending | people with backlight", {
		details: "eigf",
		estimator: "norm2",
		blending: 1,
		feathering: 10,
		iterations: 3
	}),
	J("Compress shadows/highlights | EIGF | strong", Y("eigf", 2, 20, 5, .65)),
	J("Compress shadows/highlights | GF | strong", Y("guided", 2, 500, 5, .65)),
	J("Compress shadows/highlights | EIGF | medium", Y("eigf", 3, 7, 3, .45)),
	J("Compress shadows/highlights | GF | medium", Y("guided", 3, 500, 3, .45)),
	J("Compress shadows/highlights | EIGF | soft", Y("eigf", 5, 1, 1, .25)),
	J("Compress shadows/highlights | GF | soft", Y("guided", 5, 500, 1, .25)),
	J("Contrast tone curve | soft", Kt(.25)),
	J("Contrast tone curve | medium", Kt(.45)),
	J("Contrast tone curve | strong", Kt(.65)),
	J("Relight: fill-in", {
		details: "eigf",
		estimator: "norm2",
		exposureBoost: -.5,
		bands: Gt
	})
], Jt = [
	{
		value: "simple",
		label: "Simple"
	},
	{
		value: "advanced",
		label: "Advanced"
	},
	{
		value: "masking",
		label: "Masking"
	}
], Yt = (e) => e === 0 ? "+0 EV" : `−${-e} EV`, Xt = e.map((e, t) => ({
	label: Yt(e),
	min: N.band.min,
	max: N.band.max,
	hardMin: N.band.min,
	hardMax: N.band.max,
	step: .01,
	read: (e) => e.bands[t],
	write: (e, n) => ({
		...e,
		bands: e.bands.map((e, r) => r === t ? n : e)
	}),
	commitLabel: Yt(e)
})), Zt = {
	label: "Curve smoothing",
	min: -1,
	max: 1,
	hardMin: N.smoothing.min,
	hardMax: N.smoothing.max,
	step: .01,
	read: (e) => e.curveSmoothing,
	write: (e, t) => ({
		...e,
		curveSmoothing: t
	}),
	commitLabel: "curve smoothing"
}, Qt = {
	label: "Mask exposure compensation",
	min: -4,
	max: 4,
	hardMin: N.boost.min,
	hardMax: N.boost.max,
	step: .01,
	read: (e) => e.exposureBoost,
	write: (e, t) => ({
		...e,
		exposureBoost: t
	}),
	commitLabel: "mask exposure compensation"
}, $t = {
	label: "Mask contrast compensation",
	min: -2,
	max: 2,
	hardMin: N.boost.min,
	hardMax: N.boost.max,
	step: .01,
	read: (e) => e.contrastBoost,
	write: (e, t) => ({
		...e,
		contrastBoost: t
	}),
	commitLabel: "mask contrast compensation"
}, en = {
	label: "Filter diffusion",
	min: 1,
	max: 5,
	hardMin: N.iterations.min,
	hardMax: N.iterations.max,
	step: 1,
	read: (e) => e.iterations,
	write: (e, t) => ({
		...e,
		iterations: Math.round(t)
	}),
	commitLabel: "filter diffusion"
}, tn = {
	label: "Smoothing diameter",
	min: 1,
	max: 45,
	hardMin: N.blending.min,
	hardMax: N.blending.max,
	step: .1,
	read: (e) => e.blending,
	write: (e, t) => ({
		...e,
		blending: t
	}),
	commitLabel: "smoothing diameter"
}, nn = {
	label: "Edges refinement/feathering",
	min: .1,
	max: 50,
	hardMin: N.feathering.min,
	hardMax: N.feathering.max,
	step: .01,
	read: (e) => e.feathering,
	write: (e, t) => ({
		...e,
		feathering: t
	}),
	commitLabel: "edges refinement/feathering"
};
function rn(e, t) {
	return {
		min: Math.max(e.hardMin, Math.min(e.min, t)),
		max: Math.min(e.hardMax, Math.max(e.max, t))
	};
}
var an = (e) => (String(e).split(".")[1] ?? "").length;
function on(e, t) {
	return Number(t.toFixed(an(e.step) + 1));
}
var sn = [
	{
		value: "mean",
		label: "RGB average"
	},
	{
		value: "lightness",
		label: "HSL lightness"
	},
	{
		value: "value",
		label: "HSV value / RGB max"
	},
	{
		value: "norm1",
		label: "RGB sum"
	},
	{
		value: "norm2",
		label: "RGB euclidean norm"
	},
	{
		value: "power",
		label: "RGB power norm"
	},
	{
		value: "geomean",
		label: "RGB geometric mean"
	}
], cn = [
	{
		value: "none",
		label: "No"
	},
	{
		value: "avg-guided",
		label: "Averaged guided filter"
	},
	{
		value: "guided",
		label: "Guided filter"
	},
	{
		value: "avg-eigf",
		label: "Averaged EIGF"
	},
	{
		value: "eigf",
		label: "EIGF"
	}
];
function ln(e) {
	return {
		filter: e !== "none",
		contrast: e === "eigf" || e === "guided"
	};
}
var un = "Scroll over the image to change the tone there: Shift for 1 EV steps, Alt for 0.1 EV. Esc stops.", dn = (e) => Number.isFinite(e) ? e : null;
function fn(e, t) {
	return e && e.signature === t ? e.histogram : null;
}
function pn() {
	let e = z().settings.get("tab", "simple");
	return Jt.find((t) => t.value === e)?.value ?? "simple";
}
function mn() {
	let { useEffect: e, useState: t } = z().react, { Slider: n } = z().components, { Button: r, SegmentedControl: i, Select: a, Stack: o, Toggle: s, tokens: c } = z().ui, l = z().stores.useDevelopStore, [u, d] = t(pn), p = l((e) => e.paramBag), m = V()((e) => e.probe), h = l((e) => u === "advanced" ? W(e) : ""), g = V()((e) => e.showMask), _ = V()((e) => e.adjusting), v = V()((e) => e.unstable), y = I(p), b = ln(y.details);
	e(() => {
		let e = ht();
		return () => {
			e();
			let t = V().getState();
			t.setShowMask(!1), t.setAdjusting(!1);
		};
	}, []);
	let x = () => I(l.getState().paramBag), S = () => fn(V().getState().probe, W(l.getState())), C = (e) => {
		V().getState().setUnstable(!1), l.getState().setDynParams(R(e));
	}, w = (e) => void l.getState().commitEdit(`Tone Equalizer ${e}`), T = (e) => {
		let t = on(e, e.read(y)), r = rn(e, t);
		return B(n, {
			key: e.label,
			label: e.label,
			value: t,
			min: r.min,
			max: r.max,
			step: e.step,
			defaultValue: e.read(f),
			onChange: (t) => C(e.write(x(), t)),
			onCommit: () => w(e.commitLabel)
		});
	}, ee = {
		display: "flex",
		flexDirection: "column",
		gap: 3,
		fontSize: 11,
		color: c.textSecondary
	}, E = (e, t, n, r, i) => B("label", {
		key: e,
		style: ee
	}, e, B(a, {
		value: t,
		ariaLabel: e,
		options: n.map((e) => ({
			value: e.value,
			label: e.label
		})),
		onChange: (e) => {
			let t = n.find((t) => t.value === e);
			t && (C(r(t.value)), w(i));
		}
	})), D = (e, t, n, i) => B(r, {
		size: "sm",
		disabled: !e,
		"aria-label": t,
		title: e ? t : "Wait for the preview to finish recomputing",
		onClick: () => {
			let e = S();
			if (!e) return;
			let t = i(e);
			t && (C(t), w(n));
		}
	}, "Auto"), O = (e, t) => B("div", { style: {
		display: "flex",
		alignItems: "flex-end",
		gap: 6
	} }, B("div", { style: { flex: 1 } }, e), t), te = {
		simple: () => Xt.map(T),
		advanced: () => {
			let e = (v || !L(y).valid && y.bands.some((e) => e !== 0)) && B("p", {
				key: "unstable",
				style: {
					margin: 0,
					fontSize: 10,
					color: "rgb(191, 128, 0)"
				}
			}, "The interpolation is unstable, decrease the curve smoothing"), t = fn(m, h) !== null, n = D(t, "Auto-adjust the mask exposure", "auto mask exposure", (e) => {
				let t = x(), n = dn(oe(e.first, e.last, t.exposureBoost, t.contrastBoost));
				return n === null ? null : {
					...t,
					exposureBoost: n
				};
			}), r = D(t, "Auto-adjust the mask contrast", "auto mask contrast", (e) => {
				let t = x(), n = dn(se(e.first, e.last, t));
				return n === null ? null : {
					...t,
					contrastBoost: n
				};
			});
			return [
				B(Ht, { key: "graph" }),
				e,
				T(Zt),
				O(T(Qt), n),
				b.contrast ? O(T($t), r) : null
			];
		},
		masking: () => [
			E("Luminance estimator", y.estimator, sn, (e) => ({
				...x(),
				estimator: e
			}), "luminance estimator"),
			E("Preserve details", y.details, cn, (e) => ({
				...x(),
				details: e
			}), "preserve details"),
			...b.filter ? [
				T(en),
				T(tn),
				T(nn)
			] : []
		]
	}, ne = B(a, {
		value: "",
		placeholder: "Preset",
		ariaLabel: "Preset",
		options: qt.map((e) => ({
			value: e.name,
			label: e.name
		})),
		onChange: (e) => {
			let t = qt.find((t) => t.name === e);
			t && (C(t.params), w(`preset ${t.name}`));
		}
	}), k = {
		margin: 0,
		fontSize: 10,
		lineHeight: 1.4,
		color: c.textMuted
	};
	return B(o, {
		gap: 8,
		style: { padding: "6px 8px 8px" }
	}, ne, B(i, {
		value: u,
		size: "sm",
		options: Jt.map((e) => ({
			value: e.value,
			label: e.label
		})),
		onChange: (e) => {
			let t = Jt.find((t) => t.value === e);
			t && (d(t.value), z().settings.set("tab", t.value));
		}
	}), B("div", { style: {
		display: "flex",
		flexDirection: "column",
		gap: 4
	} }, ...te[u]()), B(s, {
		label: "Display exposure mask",
		checked: g,
		onChange: (e) => V().getState().setShowMask(e)
	}), B(s, {
		label: "Adjust on image",
		checked: _,
		onChange: (e) => V().getState().setAdjusting(e)
	}), _ ? B("p", { style: k }, un) : null);
}
//#endregion
//#region src/glsl.ts
function hn(e) {
	let t = e.toPrecision(10);
	if (/e/i.test(t)) {
		let [e, n] = t.split(/e/i);
		return `${e.includes(".") ? e : `${e}.0`}e${Number(n)}`;
	}
	return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, ".0") : `${t}.0`;
}
var X = hn, gn = X(r), _n = `
float teFloor(float v) { return v > ${gn} ? v : ${gn}; }
float teNorm(vec3 p) {
  if (fNorm == 0) return length(p);
  if (fNorm == 1) return (p.r + p.g + p.b) / 3.0;
  if (fNorm == 2) return (max(max(p.r, p.g), p.b) + min(min(p.r, p.g), p.b)) / 2.0;
  if (fNorm == 3) return max(max(p.r, p.g), p.b);
  if (fNorm == 4) return abs(p.r) + abs(p.g) + abs(p.b);
  vec3 q = abs(p);
  if (fNorm == 5) {
    float d2 = dot(q, q);
    return d2 > 0.0 ? dot(q * q, q) / d2 : -1.0e30;
  }
  return pow(q.r * q.g * q.b, 1.0 / 3.0);
}
float teMask(vec3 p) {
  float v = (fExposure * teNorm(p) - fFulcrum) * fContrast + fFulcrum;
  return teFloor(v);
}
float teEigfBlend(float m, float avg, float vari) {
  float v = vari / max(avg * m, 1.0e-6);
  float a = v / (v + fEps);
  float o = a * m + (1.0 - a) * avg;
  return teFloor(o);
}
`, vn = `${_n}
float teLongEdge() { return floor(max(1.0 / uTexel.x, 1.0 / uTexel.y) + 0.5); }
float teRadius() { return trunc((fDiameter * teLongEdge() - 1.0) / 2.0); }
vec3 teState(float m) {
  float s = min(m, ${X(128)});
  return vec3(s, s * s, min(m, ${X(s)}));
}
`, yn = (e) => X(c[e + 2]), bn = `${vn}
float teB3(int d) { d = d < 0 ? -d : d; return d == 0 ? ${yn(0)} : (d == 1 ? ${yn(1)} : ${yn(2)}); }
float teSpacing(int levels) {
  float sigma = ${X(l)} * max(teRadius(), 1.0);
  return sqrt(3.0 * sigma * sigma / (exp2(2.0 * float(levels)) - 1.0));
}
vec3 teBlur(vec3 centre, float spacing) {
  vec2 sum = vec2(0.0);
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec3 t = readPrev(vUv + vec2(float(dx), float(dy)) * spacing * uTexel);
      sum += teB3(dx) * teB3(dy) * t.xy;
    }
  }
  return vec3(sum, centre.z);
}
`, xn = `${vn}
float teSpacing(int levels) {
  float r = teRadius();
  float dsr = r < 4.0 ? 1.0 : floor(r / 4.0);
  return 4.0 * (2.0 * dsr + 1.0) / exp2(float(levels));
}
vec3 teBlur(vec3 centre, float spacing) {
  float o = 0.5 * spacing;
  vec2 sum = readPrev(vUv + vec2(-o, -o) * uTexel).xy + readPrev(vUv + vec2(o, -o) * uTexel).xy
           + readPrev(vUv + vec2(-o, o) * uTexel).xy + readPrev(vUv + vec2(o, o) * uTexel).xy;
  return vec3(0.25 * sum, centre.z);
}
`, Sn = X(o), Cn = `
int levels = fLevels;
int per = levels + 1;
int iteration = uPassIndex / per;
int k = uPassIndex - iteration * per;
if (k == 0) {
  float m = iteration == 0 ? teMask(c) : teEigfBlend(c.z, c.x, c.y);
  c = teState(m);
} else {
  float spacing = teSpacing(levels) * exp2(float(k - 1));
  if (spacing >= ${Sn}) c = teBlur(c, spacing);
  if (k == levels) c.y = max(c.y - c.x * c.x, 0.0);
}
`, wn = `
int levels = fLevels;
int per = 2 * levels + 2;
int iteration = uPassIndex / per;
int k = uPassIndex - iteration * per;
if (k == 0) {
  float m = iteration == 0 ? teMask(c) : max(c.x * c.z + c.y, ${gn});
  c = teState(m);
} else if (k == levels + 1) {
  float a = c.y / max(c.y + fEps, 1.0e-15);
  c = vec3(a, c.x - a * c.x, c.z);
} else {
  int level = k <= levels ? k - 1 : k - levels - 2;
  float spacing = teSpacing(levels) * exp2(float(level));
  if (spacing >= ${Sn}) c = teBlur(c, spacing);
  if (k == levels) c.y = max(c.y - c.x * c.x, 0.0);
}
`, Tn = t.map((e, t) => `teGauss(e, ${X(e)}) * ${t < 4 ? "w0" : "w1"}.${"xyzw"[t % 4]}`).join("\n    + "), En = `${_n}
float teGauss(float e, float centre) {
  float d = e - centre;
  return exp(-d * d * gDenom);
}
float teGain(float m) {
  float e = clamp(log2(m), ${X(-8)}, ${X(0)});
  float s = ${Tn};
  return clamp(s, ${X(i)}, ${X(4)});
}
`, Dn = "\nfloat teMaskOut = -1.0;\nif (on > 0.5 || probe > 0.5) {\n  float m = teMask(lin);\n  float mi = m;\n  float mp = m;\n  if (fMode == 2) {\n    mi = fIterations > 1 ? stageResult.z : m;\n    mp = teEigfBlend(mi, stageResult.x, stageResult.y);\n  } else if (fMode == 1) {\n    mp = teFloor(stageResult.x * m + stageResult.y);\n  }\n  if (fMode != 0 && fAverage == 1) mp = sqrt(mi * mp);\n  teMaskOut = mp;\n  if (on > 0.5) lin *= teGain(mp);\n}\n", On = "\nfloat tm = isv_toneEqualizerMask;\nif (mode == 1) {\n  c = tm > 0.0 ? vec3(sqrt(clamp((tm - 0.00390625) / 0.99609375, 0.0, 1.0))) : vec3(0.5);\n} else if (mode == 2) {\n  if (tm > 0.0) {\n    float q = floor(clamp((log2(tm) + 16.0) / 24.0, 0.0, 1.0) * 65535.0 + 0.5);\n    float hi = floor(q / 256.0);\n    c = vec3(hi / 255.0, (q - hi * 256.0) / 255.0, 1.0);\n  } else {\n    c = vec3(0.0);\n  }\n}\n", kn = [
	"−8 EV",
	"−7 EV",
	"−6 EV",
	"−5 EV",
	"−4 EV",
	"−3 EV",
	"−2 EV",
	"−1 EV",
	"+0 EV"
], Z = (e, t, n) => ({
	key: e,
	glslType: "float",
	default: 0,
	...n ? { range: n } : {},
	...t ? { label: t } : {}
}), Q = (e, t, n) => ({
	...Z(e, t, n),
	glslType: "int"
}), An = (e) => ({
	key: e,
	glslType: "vec4",
	default: [
		0,
		0,
		0,
		0
	]
}), jn = [
	...Fe.map((e, t) => Z(e, kn[t], {
		min: -2,
		max: 2,
		step: .01
	})),
	Z("smoothing", "curve smoothing", {
		min: -2.33,
		max: 1.67,
		step: .01
	}),
	Z("exposureBoost", "mask exposure compensation", {
		min: -16,
		max: 16,
		step: .01
	}),
	Z("contrastBoost", "mask contrast compensation", {
		min: -16,
		max: 16,
		step: .01
	}),
	Q("details", "preserve details", {
		min: 0,
		max: 4,
		step: 1
	}),
	Q("estimator", "luminance estimator", {
		min: 0,
		max: 6,
		step: 1
	}),
	Q("diffusion", "filter diffusion", {
		min: 0,
		max: 19,
		step: 1
	}),
	Z("diameter", "smoothing diameter", {
		min: -4.99,
		max: 95,
		step: .1
	}),
	Z("feathering", "edges refinement/feathering", {
		min: -.99,
		max: 9999,
		step: .01
	})
], Mn = [
	Z("fEps"),
	Z("fExposure"),
	Z("fFulcrum"),
	Z("fContrast"),
	Q("fNorm")
], Nn = [
	Z("on"),
	Z("probe"),
	An("w0"),
	An("w1"),
	Z("gDenom"),
	Q("fMode"),
	Q("fAverage"),
	Q("fIterations"),
	...Mn
], Pn = [
	Q("fLevels"),
	Z("fDiameter"),
	...Mn
];
function Fn() {
	return {
		id: Me,
		name: "Tone Equalizer",
		phase: "scene-linear",
		priority: 50,
		reads: "current",
		space: {
			encoding: "linear",
			primaries: "rec2020"
		},
		glsl: Dn,
		helpers: En,
		uniforms: [...jn, ...Nn],
		passes: [{
			glsl: Cn,
			helpers: bn,
			iterations: {
				key: "fDrawsEigf",
				max: 300
			},
			uniforms: [...Pn, Q("fDrawsEigf")]
		}, {
			glsl: wn,
			helpers: xn,
			iterations: {
				key: "fDrawsGuided",
				max: 600
			},
			uniforms: [...Pn, Q("fDrawsGuided")]
		}],
		produces: [{
			name: Pe,
			glslType: "float",
			producer: "teMaskOut"
		}],
		presetScope: "global"
	};
}
function In() {
	return {
		id: Ne,
		name: "Tone Equalizer mask view",
		phase: "output-encode",
		priority: 1e5,
		space: {
			encoding: "perceptual",
			primaries: "rec709"
		},
		glsl: On,
		uniforms: [{
			key: "mode",
			glslType: "int",
			default: 0
		}],
		consumes: [Pe],
		presetScope: "per-image"
	};
}
function Ln() {
	return [Fn(), In()];
}
//#endregion
//#region src/index.ts
var Rn = `${je}.panel`, zn = `${je}.overlay`, $ = null;
function Bn() {
	let e = z().stores.useDevelopStore.getState();
	e.setDynParams(qe()), V().getState().setUnstable(!1), e.commitEdit("Tone Equalizer reset");
}
function Vn(e) {
	Qe(e), tt();
	for (let t of Ln()) e.registerProcessingStage(t);
	e.registerPanel({
		id: Rn,
		title: "Tone Equalizer",
		component: mn,
		defaultDock: {
			module: "develop",
			direction: "right",
			order: 6,
			width: 268
		},
		onReset: Bn
	}), e.registerSlot({
		id: zn,
		slot: "develop-canvas-overlay",
		component: Ct,
		order: 55
	}), $?.(), $ = e.stores.useDevelopStore.subscribe((e, t) => {
		if (e.photoId !== t.photoId) {
			let e = V().getState();
			e.setShowMask(!1), e.setAdjusting(!1), e.setUnstable(!1);
		}
		if (e.paramBag === t.paramBag) return;
		let n = Ye(e.paramBag);
		n && e.setDynParams(n);
	});
}
function Hn() {
	if (!$) return;
	$(), $ = null;
	let e = V().getState();
	e.setAdjusting(!1), e.setShowMask(!1);
}
//#endregion
export { Vn as activate, Hn as deactivate };

//# sourceMappingURL=index.js.map