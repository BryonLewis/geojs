var inherit = require('../inherit');
var registerFeature = require('../registry').registerFeature;
var heatmapFeature = require('../heatmapFeature');
var timestamp = require('../timestamp');

//////////////////////////////////////////////////////////////////////////////
/**
 * Create a new instance of class heatmapFeature
 * Inspired from
 *    https://github.com/mourner/simpleheat/blob/gh-pages/simpleheat.js
 *
 * @class geo.canvas.heatmapFeature
 * @param {Object} arg Options object
 * @extends geo.heatmapFeature
 * @returns {canvas_heatmapFeature}
 */
//////////////////////////////////////////////////////////////////////////////
var canvas_heatmapFeature = function (arg) {
  'use strict';

  if (!(this instanceof canvas_heatmapFeature)) {
    return new canvas_heatmapFeature(arg);
  }
  heatmapFeature.call(this, arg);

  ////////////////////////////////////////////////////////////////////////////
  /**
   * @private
   */
  ////////////////////////////////////////////////////////////////////////////
  var geo_event = require('../event');

  var m_this = this,
      m_typedBuffer,
      m_typedClampedBuffer,
      m_typedBufferData,
      m_heatMapPosition,
      s_exit = this._exit,
      s_init = this._init,
      s_update = this._update,
      m_renderTime = timestamp();

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Meta functions for converting from geojs styles to canvas.
   * @private
   */
  ////////////////////////////////////////////////////////////////////////////
  this._convertColor = function (c) {
    var color;
    if (c.hasOwnProperty('r') &&
      c.hasOwnProperty('g') &&
      c.hasOwnProperty('b') &&
      c.hasOwnProperty('a')) {
      color = 'rgba(' + 255 * c.r + ',' + 255 * c.g + ','
                    + 255 * c.b + ',' + c.a + ')';
    }
    return color;
  };

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Compute gradient (color lookup table)
   * @protected
   */
  ////////////////////////////////////////////////////////////////////////////
  this._computeGradient = function () {
    var canvas, stop, context2d, gradient, colors;

    colors = m_this.style('color');
    if (!m_this._grad || m_this._gradColors !== colors) {
      canvas = document.createElement('canvas');
      context2d = canvas.getContext('2d');
      gradient = context2d.createLinearGradient(0, 0, 0, 256);

      canvas.width = 1;
      canvas.height = 256;

      for (stop in colors) {
        gradient.addColorStop(stop, m_this._convertColor(colors[stop]));
      }

      context2d.fillStyle = gradient;
      context2d.fillRect(0, 0, 1, 256);
      m_this._grad = context2d.getImageData(0, 0, 1, 256).data;
      m_this._gradColors = colors;
    }

    return m_this;
  };

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Create circle for each data point
   * @protected
   */
  ////////////////////////////////////////////////////////////////////////////
  this._createCircle = function () {
    var circle, ctx, r, r2, blur;
    r = m_this.style('radius');
    blur = m_this.style('blurRadius');
    if (!m_this._circle || m_this._circle.radius !== r ||
        m_this._circle.blurRadius !== blur) {
      circle = m_this._circle = document.createElement('canvas');
      ctx = circle.getContext('2d');

      r2 = blur + r;

      circle.width = circle.height = r2 * 2;
      ctx.shadowOffsetX = ctx.shadowOffsetY = r2 * 2;
      ctx.shadowBlur = blur;
      ctx.shadowColor = 'black';

      ctx.beginPath();
      ctx.arc(-r2, -r2, r, 0, Math.PI * 2, true);
      ctx.closePath();
      ctx.fill();
      circle.radius = r;
      circle.blurRadius = blur;
      m_this._circle = circle;
    }
    return m_this;
  };

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Compute color for each pixel on the screen
   * @protected
   */
  ////////////////////////////////////////////////////////////////////////////
  this._colorize = function (pixels, gradient) {
    var grad = new Uint32Array(gradient.buffer),
        pixlen = pixels.length,
        i, j, k;
    if (!m_typedBuffer || m_typedBuffer.length !== pixlen) {
      m_typedBuffer = new ArrayBuffer(pixlen);
      m_typedClampedBuffer = new Uint8ClampedArray(m_typedBuffer);
      m_typedBufferData = new Uint32Array(m_typedBuffer);
    }
    for (i = 3, k = 0; i < pixlen; i += 4, k += 1) {
      // Get opacity from the temporary canvas image and look up the final
      // value from gradient
      j = pixels[i];
      if (j) {
        m_typedBufferData[k] = grad[j];
      }
    }
    pixels.set(m_typedClampedBuffer);
  };

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Render each data point on canvas
   * @protected
   */
  ////////////////////////////////////////////////////////////////////////////
  this._renderOnCanvas = function (context2d, map) {

    if (m_renderTime.getMTime() < m_this.buildTime().getMTime()) {
      var data = m_this.data() || [],
          radius = m_this.style('radius') + m_this.style('blurRadius'),
          pos, intensity, canvas, pixelArray,
          layer = m_this.layer(),
          viewport = map.camera()._viewport;

      context2d.setTransform(1, 0, 0, 1, 0, 0);
      context2d.clearRect(0, 0, viewport.width, viewport.height);
      layer.canvas().css({transform: '', 'transform-origin': '0px 0px'});

      m_this._createCircle();
      m_this._computeGradient();
      var position = m_this.gcsPosition(),
          intensityFunc = m_this.intensity(),
          minIntensity = m_this.minIntensity(),
          rangeIntensity = (m_this.maxIntensity() - minIntensity) || 1;
      for (var idx = data.length - 1; idx >= 0; idx -= 1) {
        pos = map.worldToDisplay(position[idx]);
        intensity = (intensityFunc(data[idx]) - minIntensity) / rangeIntensity;
        if (intensity <= 0) {
          continue;
        }
        // Small values are not visible because globalAlpha < .01
        // cannot be read from imageData
        context2d.globalAlpha = intensity < 0.01 ? 0.01 : (intensity > 1 ? 1 : intensity);
        context2d.drawImage(m_this._circle, pos.x - radius, pos.y - radius);
      }
      canvas = layer.canvas()[0];
      pixelArray = context2d.getImageData(0, 0, canvas.width, canvas.height);
      m_this._colorize(pixelArray.data, m_this._grad);
      context2d.putImageData(pixelArray, 0, 0);

      m_heatMapPosition = {
        zoom: map.zoom(),
        gcsOrigin: map.displayToGcs({x: 0, y: 0}, null),
        rotation: map.rotation(),
        lastScale: undefined,
        lastOrigin: {x: 0, y: 0},
        lastRotation: undefined
      };
      m_renderTime.modified();
      layer.renderer().clearCanvas(false);
    }

    return m_this;
  };

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Initialize
   * @protected
   */
  ////////////////////////////////////////////////////////////////////////////
  this._init = function () {
    s_init.call(m_this, arg);

    m_this.geoOn(geo_event.pan, m_this._animatePan);

    return m_this;
  };

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Update
   * @protected
   */
  ////////////////////////////////////////////////////////////////////////////
  this._update = function () {
    s_update.call(m_this);
    if (m_this.buildTime().getMTime() <= m_this.dataTime().getMTime() ||
        m_this.updateTime().getMTime() < m_this.getMTime()) {
      m_this._build();
    }
    m_this.updateTime().modified();
    return m_this;
  };

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Animate pan (and zoom)
   * @protected
   */
  ////////////////////////////////////////////////////////////////////////////
  this._animatePan = function (e) {

    var map = m_this.layer().map(),
        zoom = map.zoom(),
        scale = Math.pow(2, (zoom - m_heatMapPosition.zoom)),
        origin = map.gcsToDisplay(m_heatMapPosition.gcsOrigin, null),
        rotation = map.rotation();

    if (m_heatMapPosition.lastScale === scale &&
        m_heatMapPosition.lastOrigin.x === origin.x &&
        m_heatMapPosition.lastOrigin.y === origin.y &&
        m_heatMapPosition.lastRotation === rotation) {
      return;
    }

    var transform = '' +
        ' translate(' + origin.x + 'px' + ',' + origin.y + 'px' + ')' +
        ' scale(' + scale + ')' +
        ' rotate(' + ((rotation - m_heatMapPosition.rotation) * 180 / Math.PI) + 'deg)';

    m_this.layer().canvas()[0].style.transform = transform;

    m_heatMapPosition.lastScale = scale;
    m_heatMapPosition.lastOrigin.x = origin.x;
    m_heatMapPosition.lastOrigin.y = origin.y;
    m_heatMapPosition.lastRotation = rotation;

    if (m_heatMapPosition.timeout) {
      window.clearTimeout(m_heatMapPosition.timeout);
      m_heatMapPosition.timeout = undefined;
    }
    /* This conditional can change if we compute the heatmap beyond the visable
     * viewport so that we don't have to update on pans as often.  If we are
     * close to where the heatmap was originally computed, don't bother
     * updating it. */
    if (parseFloat(scale.toFixed(4)) !== 1 ||
        parseFloat((rotation - m_heatMapPosition.rotation).toFixed(4)) !== 0 ||
        parseFloat(origin.x.toFixed(1)) !== 0 ||
        parseFloat(origin.y.toFixed(1)) !== 0) {
      m_heatMapPosition.timeout = window.setTimeout(function () {
        m_heatMapPosition.timeout = undefined;
        m_this.buildTime().modified();
        m_this.layer().draw();
      }, m_this.updateDelay());
    }
  };

  ////////////////////////////////////////////////////////////////////////////
  /**
   * Destroy
   * @protected
   */
  ////////////////////////////////////////////////////////////////////////////
  this._exit = function () {
    s_exit.call(m_this);
  };

  m_this._init(arg);
  return this;
};

inherit(canvas_heatmapFeature, heatmapFeature);

// Now register it
registerFeature('canvas', 'heatmap', canvas_heatmapFeature);
module.exports = canvas_heatmapFeature;