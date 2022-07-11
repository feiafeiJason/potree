
import * as THREE from "../../libs/three.js/build/three.module.js";
import {MOUSE} from "../defines.js";
import {Utils} from "../utils.js";
import {EventDispatcher} from "../EventDispatcher.js";

export class EarthControls extends EventDispatcher {
	constructor (viewer) {
		super(viewer);

		this.viewer = viewer;
		this.renderer = viewer.renderer;

		this.scene = null;
		this.sceneControls = new THREE.Scene();

		this.rotationSpeed = 10;

		this.fadeFactor = 20;
		this.wheelDelta = 0;
		this.zoomDelta = new THREE.Vector3();
		this.camStart = null;

		this.tweens = [];

		// keyboard control
		this.translationDelta = new THREE.Vector3(0, 0, 0);
		this.translationWorldDelta = new THREE.Vector3(0, 0, 0);
		this.keys = {
			FORWARD: ['W'.charCodeAt(0), 38],
			BACKWARD: ['S'.charCodeAt(0), 40],
			LEFT: ['A'.charCodeAt(0), 37],
			RIGHT: ['D'.charCodeAt(0), 39],
			UP: ['R'.charCodeAt(0), 33],
			DOWN: ['F'.charCodeAt(0), 34],
			ROTATER: ['E'.charCodeAt(0), 41],
			ROTATEL: ['Q'.charCodeAt(0), 42],	
			ROTATEU: ['T'.charCodeAt(0), 43],  // roate up
			ROTATED: ['G'.charCodeAt(0), 44],  // roate dwon
			SPEEDUP: [14, 15,16]  // roate dwon
		};

		{
			let sg = new THREE.SphereGeometry(1, 16, 16);

			// modify the style of control
			let sm = new THREE.MeshBasicMaterial( {color: 0xffffff,side: THREE.FrontSide,
					opacity: 0.8,
					transparent: true} ); // new MeshNormalMaterial();
			this.pivotIndicator = new THREE.Mesh(sg, sm);
			this.pivotIndicator.visible = false;
			this.sceneControls.add(this.pivotIndicator);
		}

		let drag = (e) => {
			if (e.drag.object !== null) {
				return;
			}

			if (!this.pivot) {
				return;
			}

			if (e.drag.startHandled === undefined) {
				e.drag.startHandled = true;

				this.dispatchEvent({type: 'start'});
			}

			let camStart = this.camStart;
			let camera = this.scene.getActiveCamera();
			let view = this.viewer.scene.view;

			// let camera = this.viewer.scene.camera;
			let mouse = e.drag.end;
			let domElement = this.viewer.renderer.domElement;

			if (e.drag.mouse === MOUSE.LEFT) {

				let ray = Utils.mouseToRay(mouse, camera, domElement.clientWidth, domElement.clientHeight);
				let plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
					new THREE.Vector3(0, 0, 1),
					this.pivot);

				let distanceToPlane = ray.distanceToPlane(plane);

				if (distanceToPlane > 0) {
					let I = new THREE.Vector3().addVectors(
						camStart.position,
						ray.direction.clone().multiplyScalar(distanceToPlane));

					let movedBy = new THREE.Vector3().subVectors(
						I, this.pivot);

					let newCamPos = camStart.position.clone().sub(movedBy);

					view.position.copy(newCamPos);

					{
						let distance = newCamPos.distanceTo(this.pivot);
						view.radius = distance;
						let speed = view.radius / 2.5;
						this.viewer.setMoveSpeed(speed);
					}
				}
			} else if (e.drag.mouse === MOUSE.RIGHT) {
        /// Do not allow rotation when the camera is not perspective (in other word, ortho camera)
        /// Yet could it be more reasonable to provide 2D rotation function?
        if(camera.type!='PerspectiveCamera') {
          return;
        }
        
				let ndrag = {
					x: e.drag.lastDrag.x / this.renderer.domElement.clientWidth,
					y: e.drag.lastDrag.y / this.renderer.domElement.clientHeight
				};

				let yawDelta = -ndrag.x * this.rotationSpeed * 0.5;
				let pitchDelta = -ndrag.y * this.rotationSpeed * 0.2;

				let originalPitch = view.pitch;
				let tmpView = view.clone();
				tmpView.pitch = tmpView.pitch + pitchDelta;
				pitchDelta = tmpView.pitch - originalPitch;

				let pivotToCam = new THREE.Vector3().subVectors(view.position, this.pivot);
				let pivotToCamTarget = new THREE.Vector3().subVectors(view.getPivot(), this.pivot);
				let side = view.getSide();

				pivotToCam.applyAxisAngle(side, pitchDelta);
				pivotToCamTarget.applyAxisAngle(side, pitchDelta);

				pivotToCam.applyAxisAngle(new THREE.Vector3(0, 0, 1), yawDelta);
				pivotToCamTarget.applyAxisAngle(new THREE.Vector3(0, 0, 1), yawDelta);

				let newCam = new THREE.Vector3().addVectors(this.pivot, pivotToCam);
				// TODO: Unused: let newCamTarget = new THREE.Vector3().addVectors(this.pivot, pivotToCamTarget);

				view.position.copy(newCam);
				view.yaw += yawDelta;
				view.pitch += pitchDelta;
			}
		};

		let onMouseDown = e => {
			let mouse = e.mouse;
      let camera = this.scene.getActiveCamera();
      let viewer = this.viewer;
      let scene = this.scene.scene;
      
      let I = Utils.getMousePointCloudIntersection(
        mouse, 
        camera, 
        viewer, 
        this.scene.pointclouds, 
        {pickClipped: false});

      let targetPt;
      if (I) {
        this.pivot = I.location;
        this.camStart = this.scene.getActiveCamera().clone();
        this.pivotIndicator.visible = true;
        this.pivotIndicator.position.copy(I.location);
      }
      else {
        // Still want to pick other objects than pointclouds, like meshes
        let renderer = viewer.renderer;
    
        let nmouse = {
          x: (mouse.x / renderer.domElement.clientWidth) * 2 - 1,
          y: -(mouse.y / renderer.domElement.clientHeight) * 2 + 1
        };
        
        let raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(nmouse, camera);
        
        let intersects = raycaster.intersectObjects(scene.children);
        
        // Pick the nearest intersection point if any
        if(intersects[0]) {
          /// 'intersect.face.normal' should be pointing out the direction of the intersecting face. This might be useful, but how?
          // If found intersect, pick up 'intersect.point' as the pivot location
          targetPt = intersects[0].point
        }
        else {
          // Pick the ground point (height=0) intersect with the pick ray
          let ray = raycaster.ray;
          let origin = ray.origin;
          let direction = ray.direction;
          
          // If pointing to the sky instead of the ground, do nothing
          if(direction.z<0) {
            // Find xyz of ground target point downwards
            let zRatio = origin.z / (-direction.z);
            let targetX = origin.x + zRatio*direction.x;
            let targetY = origin.y + zRatio*direction.y;
            
            targetPt = new THREE.Vector3(targetX, targetY, 0);
          }
        }
        if(targetPt) {
          this.pivot = targetPt;
          this.camStart = this.scene.getActiveCamera().clone();
          this.pivotIndicator.visible = true;
          this.pivotIndicator.position.copy(targetPt);
        }
      }
		};

		let drop = e => {
			this.dispatchEvent({type: 'end'});
		};

		let onMouseUp = e => {
			this.camStart = null;
			this.pivot = null;
			this.pivotIndicator.visible = false;
		};

		let scroll = (e) => {
			this.wheelDelta += e.delta;
		};

		let dblclick = (e) => {
			this.zoomToLocation(e.mouse);
		};

		this.addEventListener('drag', drag);
		this.addEventListener('drop', drop);
		this.addEventListener('mousewheel', scroll);
		this.addEventListener('mousedown', onMouseDown);
		this.addEventListener('mouseup', onMouseUp);
		this.addEventListener('dblclick', dblclick);
	}

	setScene (scene) {
		this.scene = scene;
	}

	stop(){
		this.wheelDelta = 0;
		this.zoomDelta.set(0, 0, 0);
	}
	
	zoomToLocation(mouse){
		let camera = this.scene.getActiveCamera();
		
		let I = Utils.getMousePointCloudIntersection(
			mouse,
			camera,
			this.viewer,
			this.scene.pointclouds);

		if (I === null) {
			return;
		}

		let targetRadius = 0;
		{
			let minimumJumpDistance = 0.2;

			let domElement = this.renderer.domElement;
			let ray = Utils.mouseToRay(mouse, camera, domElement.clientWidth, domElement.clientHeight);

			let nodes = I.pointcloud.nodesOnRay(I.pointcloud.visibleNodes, ray);
			let lastNode = nodes[nodes.length - 1];
			let radius = lastNode.getBoundingSphere(new THREE.Sphere()).radius;
			targetRadius = Math.min(this.scene.view.radius, radius);
			targetRadius = Math.max(minimumJumpDistance, targetRadius);
		}

		let d = this.scene.view.direction.multiplyScalar(-1);
		let cameraTargetPosition = new THREE.Vector3().addVectors(I.location, d.multiplyScalar(targetRadius));
		// TODO Unused: let controlsTargetPosition = I.location;

		let animationDuration = 600;
		let easing = TWEEN.Easing.Quartic.Out;

		{ // animate
			let value = {x: 0};
			let tween = new TWEEN.Tween(value).to({x: 1}, animationDuration);
			tween.easing(easing);
			this.tweens.push(tween);

			let startPos = this.scene.view.position.clone();
			let targetPos = cameraTargetPosition.clone();
			let startRadius = this.scene.view.radius;
			let targetRadius = cameraTargetPosition.distanceTo(I.location);

			tween.onUpdate(() => {
				let t = value.x;
				this.scene.view.position.x = (1 - t) * startPos.x + t * targetPos.x;
				this.scene.view.position.y = (1 - t) * startPos.y + t * targetPos.y;
				this.scene.view.position.z = (1 - t) * startPos.z + t * targetPos.z;

				this.scene.view.radius = (1 - t) * startRadius + t * targetRadius;
				this.viewer.setMoveSpeed(this.scene.view.radius / 2.5);
			});

			tween.onComplete(() => {
				this.tweens = this.tweens.filter(e => e !== tween);
			});

			tween.start();
		}
	}

  // Delta here is from 'viewer.clock.getDelta()'
	update (delta) {
		let view = this.scene.view;
    // view.yaw = -heading
    
    // console.log(view);
		let fade = Math.pow(0.5, this.fadeFactor * delta);
		let progression = 1 - fade;
		let camera = this.scene.getActiveCamera();

		// keyboard control
		{ // accelerate while input is given
			let ih = this.viewer.inputHandler;

			let moveForward = this.keys.FORWARD.some(e => ih.pressedKeys[e]);
			let moveBackward = this.keys.BACKWARD.some(e => ih.pressedKeys[e]);
			let moveLeft = this.keys.LEFT.some(e => ih.pressedKeys[e]);
			let moveRight = this.keys.RIGHT.some(e => ih.pressedKeys[e]);
			let moveUp = this.keys.UP.some(e => ih.pressedKeys[e]);
			let moveDown = this.keys.DOWN.some(e => ih.pressedKeys[e]);

			let rotateLeft = this.keys.ROTATEL.some(e => ih.pressedKeys[e]);
			let rotateRight = this.keys.ROTATER.some(e => ih.pressedKeys[e]);
			let rotateUp = this.keys.ROTATEU.some(e => ih.pressedKeys[e]);
			let rotateDown = this.keys.ROTATED.some(e => ih.pressedKeys[e]);
			let speedUp = this.keys.SPEEDUP.some(e => ih.pressedKeys[e]);
      
      let effectScale = 0.1;
      
      // rotate event
			if (rotateLeft && rotateRight) {
			}
			else if (rotateRight) {
				// console.log("rotateRight")
				this.yawDelta = 1 * effectScale
			} else if (rotateLeft) {
				// console.log("rotateLeft")
				this.yawDelta = -1 * effectScale
			} else { 
				this.yawDelta = 0
			}

			if (rotateDown && rotateUp) {
			}
			else if (rotateUp) {
				this.pitchDelta = -1*effectScale
			} else if (rotateDown) {
				this.pitchDelta = 1*effectScale
			}else { 
				this.pitchDelta = 0
			}
			
			// speed up effect
			if (speedUp) {
				delta *= 4
			}
      
      // Compute yaw and pitch
      let progression = Math.min(1, this.fadeFactor * delta);
      let yaw = view.yaw;
			let pitch = view.pitch;
      
      yaw -= progression * this.yawDelta;
      pitch -= progression * this.pitchDelta;
      
      view.yaw = yaw;
      view.pitch = pitch;

      // translationDelta -> translationWorldDelta
      // Reset translation
      this.translationWorldDelta = new THREE.Vector3(0,0,0);
      
			if (moveForward && moveBackward) {
				this.translationWorldDelta.y += 0;
			} else if (moveForward) {
				this.translationWorldDelta.y += Math.cos(-view.yaw) * this.viewer.getMoveSpeed();
        this.translationWorldDelta.x += Math.sin(-view.yaw) * this.viewer.getMoveSpeed();
			} else if (moveBackward) {
				this.translationWorldDelta.y += -Math.cos(-view.yaw) * this.viewer.getMoveSpeed();
        this.translationWorldDelta.x += -Math.sin(-view.yaw) * this.viewer.getMoveSpeed();
			}else{
				this.translationWorldDelta.y += 0;
			}
			
			if (moveLeft && moveRight) {
				this.translationWorldDelta.x += 0;
			} else if (moveLeft) {
				this.translationWorldDelta.y += Math.cos(-view.yaw-Math.PI/2) * this.viewer.getMoveSpeed();
        this.translationWorldDelta.x += Math.sin(-view.yaw-Math.PI/2) * this.viewer.getMoveSpeed();
			} else if (moveRight) {
				this.translationWorldDelta.y += Math.cos(-view.yaw+Math.PI/2) * this.viewer.getMoveSpeed();
        this.translationWorldDelta.x += Math.sin(-view.yaw+Math.PI/2) * this.viewer.getMoveSpeed();
			}else{
				this.translationWorldDelta.x += 0;
			}
			

			if (moveUp && moveDown) {
				this.translationWorldDelta.z = 0;
			} else if (moveUp) {
				this.translationWorldDelta.z = this.viewer.getMoveSpeed();
			} else if (moveDown) {
				this.translationWorldDelta.z = -this.viewer.getMoveSpeed();
			}else{
				this.translationWorldDelta.z = 0;
			}
		}
		
		// compute zoom
    /// See the mouse down event when dealing with mouse pointing to other objects than pointcloud
    if (this.wheelDelta !== 0) {
      let mouse = this.viewer.inputHandler.mouse;
      let camera = this.scene.getActiveCamera();
      let viewer = this.viewer;
      let scene = this.scene.scene;
      
      let I = Utils.getMousePointCloudIntersection(
        mouse, 
        camera, 
        viewer, 
        this.scene.pointclouds);

      let targetPt;
      if (I) {
        targetPt = I.location;
      }
      else {
        // Refer to operation in mouse down event
        let renderer = viewer.renderer;
    
        let nmouse = {
          x: (mouse.x / renderer.domElement.clientWidth) * 2 - 1,
          y: -(mouse.y / renderer.domElement.clientHeight) * 2 + 1
        };
        
        let raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(nmouse, camera);
        
        let intersects = raycaster.intersectObjects(scene.children);
        
        // Pick the nearest intersection point if any
        if(intersects[0]) {
          // If found intersect, pick up 'intersect.point' as the pivot location
          targetPt = intersects[0].point
        }
        else {
          // Pick the ground point (height=0) intersect with the pick ray
          let ray = raycaster.ray;
          let origin = ray.origin;
          let direction = ray.direction;
          
          // If pointing to the sky instead of the ground, do nothing
          if(direction.z<0) {
            // Find xyz of ground target point downwards
            let zRatio = origin.z / (-direction.z);
            let targetX = origin.x + zRatio*direction.x;
            let targetY = origin.y + zRatio*direction.y;
            
            targetPt = new THREE.Vector3(targetX, targetY, 0);
          }
        }
      }
      
      if(targetPt) {
        // One extra meter to help zooming into indoor
        /*
        console.log(targetPt);
        console.log(view.position);
        console.log(this.zoomDelta);
        console.log('----------------------------------');
         */
        
        let resolvedPos = new THREE.Vector3().addVectors(view.position, this.zoomDelta);
        let distance = targetPt.distanceTo(resolvedPos);
        distance++;
        let jumpDistance = distance * 0.2 * this.wheelDelta;
        let targetDir = new THREE.Vector3().subVectors(targetPt, view.position);
        targetDir.normalize();

        resolvedPos.add(targetDir.multiplyScalar(jumpDistance));
        this.zoomDelta.subVectors(resolvedPos, view.position);

        {
          let distance = resolvedPos.distanceTo(targetPt);
          view.radius = distance;
          distance++;
          let speed = view.radius / 2.5;
          this.viewer.setMoveSpeed(speed);
        }
      }
    }

    /// Obsoleted for not catering for user's habits
		// { // apply rotation
			// let progression = Math.min(1, this.fadeFactor * delta);

			// let yaw = view.yaw;
			// let pitch = view.pitch;
			// let pivot = view.getPivot();

			// yaw -= progression * this.yawDelta;
			// pitch -= progression * this.pitchDelta;

			// view.yaw = yaw;
			// view.pitch = pitch;

			// let V = this.scene.view.direction.multiplyScalar(-view.radius);
			// let position = new THREE.Vector3().addVectors(pivot, V);

			// view.position.copy(position);
		// }

		// { // apply pan
		// 	let progression = Math.min(1, this.fadeFactor * delta);
		// 	let panDistance = progression * view.radius * 3;

		// 	let px = -this.panDelta.x * panDistance;
		// 	let py = this.panDelta.y * panDistance;

		// 	view.pan(px, py);
		// }
	
		{ // apply translation
			view.translate(
				this.translationDelta.x * delta,
				this.translationDelta.y * delta,
				this.translationDelta.z * delta
			);

			view.translateWorld(
				this.translationWorldDelta.x * delta,
				this.translationWorldDelta.y * delta,
				this.translationWorldDelta.z * delta
			);
		}

		// { // apply zoom
		// 	let progression = Math.min(1, this.fadeFactor * delta);

		// 	// let radius = view.radius + progression * this.radiusDelta * view.radius * 0.1;
		// 	let radius = view.radius + progression * this.radiusDelta;

		// 	let V = view.direction.multiplyScalar(-radius);
		// 	let position = new Vector3().addVectors(view.getPivot(), V);
		// 	view.radius = radius;

		// 	view.position.copy(position);
		// }

		// apply zoom
		if (this.zoomDelta.length() !== 0) {
			let p = this.zoomDelta.clone().multiplyScalar(progression);

			let newPos = new THREE.Vector3().addVectors(view.position, p);
			view.position.copy(newPos);
		}

		if (this.pivotIndicator.visible) {
			let distance = this.pivotIndicator.position.distanceTo(view.position);
			let pixelwidth = this.renderer.domElement.clientwidth;
			let pixelHeight = this.renderer.domElement.clientHeight;
			let pr = Utils.projectedRadius(1, camera, distance, pixelwidth, pixelHeight);
			let scale = (10 / pr);
			this.pivotIndicator.scale.set(scale, scale, scale);
		}

		{
			let speed = view.radius;
			this.viewer.setMoveSpeed(speed);
		}

		// decelerate over time
		{
			this.zoomDelta.multiplyScalar(fade);
			this.wheelDelta = 0;
		}
	}
};
